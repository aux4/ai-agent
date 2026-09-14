import fs from "node:fs";
import net from "node:net";

import { clearRuntimeRequestContext, setRuntimeRequestContext } from "../lib/RuntimeContext.js";
import {
  WARM_RUNTIME_PROTOCOL,
  encodeFrame,
  frameReader,
  replaceEnvironment,
  sanitizedEnvironment
} from "../lib/WarmRuntimeProtocol.js";

function asBuffer(chunk, encoding) {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === "string" ? encoding : "utf8");
}

function replaceWrite(stream, chunks) {
  const original = stream.write;
  stream.write = function(chunk, encoding, callback) {
    chunks.push(asBuffer(chunk, encoding));
    if (typeof encoding === "function") encoding();
    if (typeof callback === "function") callback();
    return true;
  };
  return () => { stream.write = original; };
}

function normalizeRequest(request, identity) {
  if (request?.protocol !== WARM_RUNTIME_PROTOCOL || request.identity !== identity) {
    throw new Error("Warm runtime identity mismatch");
  }
  if (!Array.isArray(request.args) || request.args.some(value => typeof value !== "string")) {
    throw new Error("Warm runtime args must be strings");
  }
  if (typeof request.cwd !== "string" || !request.cwd) throw new Error("Warm runtime cwd is required");
  if (!request.env || typeof request.env !== "object" || Array.isArray(request.env)) {
    throw new Error("Warm runtime environment is required");
  }
  return {
    args: request.args,
    cwd: request.cwd,
    env: Object.fromEntries(Object.entries(request.env).map(([name, value]) => [name, String(value)])),
    stdin: typeof request.stdin === "string" ? request.stdin : ""
  };
}

export async function executeWarmRuntimeRequest(request, options) {
  const normalized = normalizeRequest(request, options.identity);
  const stdout = [];
  const stderr = [];
  const restoreStdout = replaceWrite(process.stdout, stdout);
  const restoreStderr = replaceWrite(process.stderr, stderr);
  const baseEnvironment = options.baseEnvironment;
  const baseCwd = options.baseCwd;
  let exitCode = 0;

  try {
    replaceEnvironment({ ...baseEnvironment, ...normalized.env });
    process.chdir(normalized.cwd);
    setRuntimeRequestContext({ stdin: normalized.stdin, warm: true });
    try {
      await options.dispatch(normalized.args);
    } catch (error) {
      exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1;
      options.reportError(error);
    }
  } finally {
    clearRuntimeRequestContext();
    try { process.chdir(baseCwd); } catch { process.chdir("/tmp"); }
    replaceEnvironment(baseEnvironment);
    restoreStderr();
    restoreStdout();
  }

  return {
    protocol: WARM_RUNTIME_PROTOCOL,
    exitCode,
    stdout: Buffer.concat(stdout).toString("base64"),
    stderr: Buffer.concat(stderr).toString("base64")
  };
}

export async function serveWarmRuntime({ socketPath, identity, dispatch, reportError }) {
  const baseCwd = process.cwd();
  const baseEnvironment = sanitizedEnvironment(process.env);
  replaceEnvironment(baseEnvironment);

  try { fs.unlinkSync(socketPath); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  let queue = Promise.resolve();
  const server = net.createServer(socket => {
    let received = false;
    const fail = error => {
      if (!socket.destroyed) socket.destroy(error);
    };
    socket.on("data", frameReader(request => {
      if (received) return fail(new Error("Warm runtime accepts one request per connection"));
      received = true;
      const run = () => executeWarmRuntimeRequest(request, {
        identity,
        dispatch,
        reportError,
        baseCwd,
        baseEnvironment
      });
      const response = queue.then(run, run);
      queue = response.then(() => undefined, () => undefined);
      response.then(value => socket.end(encodeFrame(value)), fail);
    }, fail));
  });

  server.on("error", error => {
    if (error?.code !== "EADDRINUSE") throw error;
    process.exitCode = 0;
  });
  server.listen(socketPath, () => {
    try { fs.chmodSync(socketPath, 0o600); } catch {}
  });

  const cleanup = () => {
    try { fs.unlinkSync(socketPath); } catch {}
  };
  process.once("exit", cleanup);
  process.once("SIGTERM", () => server.close(() => process.exit(0)));
  process.once("SIGINT", () => server.close(() => process.exit(0)));
}
