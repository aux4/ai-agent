import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { executeWarmRuntimeRequest } from "../src/bin/WarmRuntimeServer.js";
import { runtimeRequestInput } from "../src/lib/RuntimeContext.js";
import {
  WARM_RUNTIME_PROTOCOL,
  runtimeIdentity,
  runtimeSocketPath,
  sanitizedEnvironment
} from "../src/lib/WarmRuntimeProtocol.js";

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
