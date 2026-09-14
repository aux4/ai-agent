import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import { executeWarmRuntimeRequest, serveWarmRuntime } from "../src/bin/WarmRuntimeServer.js";
import { runtimeRequestInput } from "../src/lib/RuntimeContext.js";
import {
  WARM_RUNTIME_PROTOCOL,
  encodeFrame,
  frameReader,
  runtimeIdentity,
  runtimeSocketPath,
  sanitizedEnvironment
} from "../src/lib/WarmRuntimeProtocol.js";

async function connectWhenReady(socketPath) {
  let lastError;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        const socket = net.createConnection(socketPath);
        socket.once("connect", () => resolve(socket));
        socket.once("error", reject);
      });
    } catch (error) {
      lastError = error;
      await delay(5);
    }
  }
  throw lastError;
}

function sendHalfClosedRequest(socket, value) {
  return new Promise((resolve, reject) => {
    let received = false;
    socket.on("data", frameReader(response => {
      if (received) return;
      received = true;
      resolve(response);
    }, reject));
    socket.once("error", reject);
    socket.once("end", () => {
      if (!received) reject(new Error("server closed without a response"));
    });
    socket.end(encodeFrame(value));
  });
}

function request(identity, cwd, overrides = {}) {
  return {
    protocol: WARM_RUNTIME_PROTOCOL,
    identity,
    cwd,
    env: {},
    args: ["probe"],
    stdin: "",
    ...overrides
  };
}

test("warm requests isolate cwd, stdin, args, and credentials", async () => {
  const baseCwd = process.cwd();
  const baseEnvironment = sanitizedEnvironment(process.env);
  const firstDir = await mkdtemp(path.join(os.tmpdir(), "aux4-ai-first-"));
  const secondDir = await mkdtemp(path.join(os.tmpdir(), "aux4-ai-second-"));
  const identity = "runtime-test";
  const observations = [];
  const options = {
    identity,
    baseCwd,
    baseEnvironment,
    dispatch: async args => {
      observations.push({
        args: [...args],
        cwd: process.cwd(),
        stdin: runtimeRequestInput(),
        token: process.env.AUX4_ACCESS_TOKEN
      });
      console.log(`result-${args[1]}`);
    },
    reportError: error => console.error(error.message)
  };

  try {
    const first = await executeWarmRuntimeRequest(request(identity, firstDir, {
      args: ["probe", "one"], stdin: "message-one", env: { AUX4_ACCESS_TOKEN: "token-one" }
    }), options);
    const second = await executeWarmRuntimeRequest(request(identity, secondDir, {
      args: ["probe", "two"], stdin: "message-two", env: {}
    }), options);

    assert.equal(Buffer.from(first.stdout, "base64").toString("utf8"), "result-one\n");
    assert.equal(Buffer.from(second.stdout, "base64").toString("utf8"), "result-two\n");
    const firstReal = await realpath(firstDir);
    const secondReal = await realpath(secondDir);
    assert.deepEqual(observations, [
      { args: ["probe", "one"], cwd: firstReal, stdin: "message-one", token: "token-one" },
      { args: ["probe", "two"], cwd: secondReal, stdin: "message-two", token: undefined }
    ]);
    assert.equal(process.cwd(), baseCwd);
    assert.equal(process.env.AUX4_ACCESS_TOKEN, baseEnvironment.AUX4_ACCESS_TOKEN);
    assert.equal(runtimeRequestInput(), undefined);
  } finally {
    await rm(firstDir, { recursive: true, force: true });
    await rm(secondDir, { recursive: true, force: true });
  }
});

test("warm runtime rejects a stale package identity", async () => {
  await assert.rejects(
    executeWarmRuntimeRequest(request("old-runtime", process.cwd()), {
      identity: "new-runtime",
      baseCwd: process.cwd(),
      baseEnvironment: sanitizedEnvironment(process.env),
      dispatch: async () => {},
      reportError: () => {}
    }),
    /identity mismatch/
  );
});

test("warm socket returns after the client half-closes its request side", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aux4-ai-socket-"));
  const socketPath = path.join(dir, "runtime.sock");
  const identity = "socket-runtime";
  const server = await serveWarmRuntime({
    socketPath,
    identity,
    dispatch: async () => { await delay(20); },
    reportError: () => {}
  });

  try {
    const socket = await connectWhenReady(socketPath);
    const response = await sendHalfClosedRequest(socket, request(identity, process.cwd()));
    assert.equal(response.protocol, WARM_RUNTIME_PROTOCOL);
    assert.equal(response.exitCode, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test("runtime identity and socket change when the installed artifact changes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aux4-ai-identity-"));
  const runtimeFile = path.join(dir, "runtime.cjs");
  try {
    await writeFile(runtimeFile, "first");
    const first = runtimeIdentity(runtimeFile);
    await writeFile(runtimeFile, "second-version");
    const second = runtimeIdentity(runtimeFile);
    assert.notEqual(first, second);
    assert.notEqual(runtimeSocketPath(first), runtimeSocketPath(second));
    assert.ok(runtimeSocketPath(second).length < 100);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
