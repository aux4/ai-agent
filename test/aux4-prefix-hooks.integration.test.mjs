import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTools } from "../src/lib/Tools.js";
import { normalizeExecuteAux4Command } from "../src/lib/Hooks.js";
import { Policy } from "../src/lib/Policy.js";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aux4-prefix-hooks-"));
}

function writeHooks(dir, hooks) {
  const file = path.join(dir, "hooks.json");
  fs.writeFileSync(file, JSON.stringify({ hooks }));
  return file;
}

test("exact aux4 package namespace route wins over executable-prefix fallback", async () => {
  const resolved = normalizeExecuteAux4Command("aux4 pkger list");
  assert.equal(resolved.command, "aux4 pkger list");
  assert.equal(resolved.commandPath, "aux4:pkger/list");
  assert.equal(resolved.normalizedFromExecutablePrefix, undefined);

  for (const command of ["aux4 agent browser run --goal test", "aux4 aux4 agent browser run --goal test"]) {
    const fallback = normalizeExecuteAux4Command(command);
    assert.equal(fallback.command, "agent browser run --goal test");
    assert.equal(fallback.commandPath, "agent:browser/run");
    assert.equal(fallback.normalizedFromExecutablePrefix, true);
  }

  const quoted = normalizeExecuteAux4Command("'aux4' agent browser run --goal test");
  assert.equal(quoted.command, "'aux4' agent browser run --goal test");
  assert.equal(quoted.commandPath, null);
  assert.equal(quoted.normalizedFromExecutablePrefix, undefined);

  const dir = tempDir();
  try {
    const marker = path.join(dir, "namespace-route.txt");
    const hooksFile = writeHooks(dir, [{
      tool: "executeAux4",
      command: "aux4:pkger/list",
      before: [`file:${marker}:value(__command)`, "exit 1"]
    }]);
    const tools = createTools({ hooksFile });
    const result = await tools.executeAux4.invoke({ command: "aux4 pkger list", timeout: 5 });
    assert.match(String(result), /^Blocked by hook:/);
    assert.equal(fs.readFileSync(marker, "utf8").trim().replace(/^['"]|['"]$/g, ""), "aux4:pkger/list");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("prefixed executeAux4 call runs the canonical before hook before dispatch", async () => {
  const dir = tempDir();
  try {
    const marker = path.join(dir, "matched-route.txt");
    const dispatched = path.join(dir, "hook-command.txt");
    const hooksFile = writeHooks(dir, [{
      tool: "executeAux4",
      command: "agent:browser/run",
      before: [`file:${marker}:value(__command)`, `file:${dispatched}:value(__commandLine)`, "exit 1"]
    }]);
    const tools = createTools({ hooksFile, permissions: { allow: ["*"] } });

    const result = await tools.executeAux4.invoke({
      command: "aux4 agent browser run --goal harmless-test",
      timeout: 5
    });

    assert.match(String(result), /^Blocked by hook:/);
    assert.equal(fs.readFileSync(marker, "utf8").trim().replace(/^['"]|['"]$/g, ""), "agent:browser/run");
    assert.equal(fs.readFileSync(dispatched, "utf8").trim().replace(/^['"]|['"]$/g, ""), "agent browser run --goal harmless-test");
    assert.doesNotMatch(String(result), /browser session|run completed/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("canonical hook runs before the static permission check for a redundant prefix", async () => {
  const dir = tempDir();
  try {
    const marker = path.join(dir, "hook-ran.txt");
    const hooksFile = writeHooks(dir, [{
      tool: "executeAux4",
      command: "agent:browser/run",
      before: [`file:${marker}:value(__command)`]
    }]);
    const tools = createTools({
      hooksFile,
      permissions: { allow: ["aux4:pkger/list"], deny: ["agent:browser/run"] }
    });

    const result = await tools.executeAux4.invoke({
      command: "aux4 agent browser run --goal harmless-test",
      timeout: 5
    });

    assert.match(String(result), /Permission denied/);
    assert.equal(fs.readFileSync(marker, "utf8").trim().replace(/^['"]|['"]$/g, ""), "agent:browser/run");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("prefix normalization uses the execution cwd and the real tool dispatches only after the hook", async () => {
  const dir = tempDir();
  try {
    const hookRuns = path.join(dir, "hook-runs.txt");
    const actionRuns = path.join(dir, "action-runs.txt");
    fs.writeFileSync(path.join(dir, ".aux4"), JSON.stringify({
      scope: "fixture",
      name: "hook-prefix-test",
      version: "0.0.1",
      profiles: [{
        name: "main",
        commands: [{
          name: "mutate",
          execute: [`file:${actionRuns}:+ran`],
          help: { text: "Append one run record" }
        }]
      }]
    }));

    const policy = Policy.load({ deny: [{ executeAux4: ["mutate"] }] });
    const policyDenied = createTools({ policy });
    const policyResult = await policyDenied.executeAux4.invoke({ command: "aux4 mutate", cwd: dir, timeout: 5 });
    assert.match(String(policyResult), /policy denied/);
    assert.equal(fs.existsSync(actionRuns), false);
    assert.equal(policy.decisions.at(-1).action, "executeAux4(mutate)");

    const staticallyAllowed = createTools({ permissions: { allow: ["mutate"] } });
    const staticResult = await staticallyAllowed.executeAux4.invoke({ command: "aux4 mutate", cwd: dir, timeout: 5 });
    assert.doesNotMatch(String(staticResult), /Permission denied/);
    assert.equal(fs.readFileSync(actionRuns, "utf8"), "ran\n");
    fs.writeFileSync(actionRuns, "");

    const deniedHooks = writeHooks(dir, [{
      tool: "executeAux4",
      command: "main/mutate",
      before: [`file:${hookRuns}:+ran`, "exit 1"]
    }]);
    const denied = createTools({ hooksFile: deniedHooks, permissions: { allow: ["*"] } });
    const deniedResult = await denied.executeAux4.invoke({ command: "aux4 mutate", cwd: dir, timeout: 5 });
    assert.match(String(deniedResult), /^Blocked by hook:/);
    assert.equal(fs.readFileSync(hookRuns, "utf8"), "ran\n");
    assert.equal(fs.readFileSync(actionRuns, "utf8"), "");

    fs.writeFileSync(hookRuns, "");
    const allowedHooks = writeHooks(dir, [{
      tool: "executeAux4",
      command: "main/mutate",
      before: [`file:${hookRuns}:+ran`]
    }]);
    for (const [index, command] of ["mutate", "aux4 mutate", "aux4 aux4 mutate"].entries()) {
      const allowed = createTools({ hooksFile: allowedHooks, permissions: { allow: ["*"] } });
      const result = await allowed.executeAux4.invoke({ command, cwd: dir, timeout: 5 });
      assert.doesNotMatch(String(result), /Permission denied|Blocked by hook/);
      assert.equal(fs.readFileSync(hookRuns, "utf8"), "ran\n".repeat(index + 1));
      assert.equal(fs.readFileSync(actionRuns, "utf8"), "ran\n".repeat(index + 1));
    }

    fs.writeFileSync(actionRuns, "");
    const guarded = createTools({ permissions: { allow: ["*"] } });
    for (const command of ["'aux4' mutate", "aux4 missing-target", "aux4 mutate ; aux4 mutate"]) {
      const result = await guarded.executeAux4.invoke({ command, cwd: dir, timeout: 5 });
      assert.doesNotMatch(String(result), /ran successfully/);
      assert.equal(fs.existsSync(actionRuns) && fs.readFileSync(actionRuns, "utf8"), "");
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
