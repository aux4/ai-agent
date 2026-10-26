import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

// Real tools (Tools.js) always declare a zod schema; @langchain/core's tool() only
// forwards the call's args to the implementation when one is present, so every fake
// tool here needs one too -- otherwise `tool()` silently calls the implementation with
// `undefined` instead of the invoke() argument, which has nothing to do with hooks.
const PASSTHROUGH_SCHEMA = z.object({}).passthrough();

import {
  matchPattern,
  matchParams,
  matchHooks,
  parseExecuteAux4Call,
  loadHooks,
  resolveCommandPath,
  wrapWithHooks,
  isInsideHook
} from "../src/lib/Hooks.js";

test("matchPattern: exact profile/command", () => {
  assert.equal(matchPattern("agent:browser/run", "agent:browser/run"), true);
  assert.equal(matchPattern("agent:browser/run", "agent:browser/stop"), false);
});

test("matchPattern: * wildcard matches any single segment, segment counts must match", () => {
  assert.equal(matchPattern("*/run", "agent:browser/run"), true);
  assert.equal(matchPattern("agent:browser/*", "agent:browser/run"), true);
  assert.equal(matchPattern("*/*", "agent:browser/run"), true);
  assert.equal(matchPattern("*/*/*", "agent:browser/run"), false);
});

test("matchParams: missing param never matches", () => {
  assert.equal(matchParams({ field: "confirm=yes" }, {}), false);
  assert.equal(matchParams({ field: "confirm=yes" }, { other: "x" }), false);
});

test("matchParams: empty filter always matches", () => {
  assert.equal(matchParams({}, {}), true);
  assert.equal(matchParams(undefined, { a: "1" }), true);
});

test("matchParams: | alternatives", () => {
  assert.equal(matchParams({ env: "dev|staging" }, { env: "staging" }), true);
  assert.equal(matchParams({ env: "dev|staging" }, { env: "prod" }), false);
});

test("matchParams: repeatable value matches if ANY value matches", () => {
  assert.equal(matchParams({ field: "confirm=yes" }, { field: ["id=12345", "confirm=yes"] }), true);
  assert.equal(matchParams({ field: "confirm=yes" }, { field: ["id=12345", "name=Bob"] }), false);
});

test("parseExecuteAux4Call: splits action words from flags, repeatable flag becomes array", () => {
  const { actionWords, params } = parseExecuteAux4Call(
    "agent browser run --field id=12345 --field confirm=yes --timeout 30"
  );
  assert.deepEqual(actionWords, ["agent", "browser", "run"]);
  assert.deepEqual(params.field, ["id=12345", "confirm=yes"]);
  assert.equal(params.timeout, "30");
});

test("parseExecuteAux4Call: --name=value form", () => {
  const { params } = parseExecuteAux4Call("x --k=v");
  assert.equal(params.k, "v");
});

test("parseExecuteAux4Call: boolean flag with no value defaults to true", () => {
  const { params } = parseExecuteAux4Call("x --verbose --name Bob");
  assert.equal(params.verbose, "true");
  assert.equal(params.name, "Bob");
});

test("loadHooks: normalizes defaults and preserves declaration order", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-test-"));
  const file = path.join(tmp, "hooks.json");
  fs.writeFileSync(file, JSON.stringify({
    hooks: [
      { command: "*/run", before: ["log:a"] },
      { command: "*/run", order: -5, before: ["log:b"] }
    ]
  }));
  const hooks = loadHooks(file);
  assert.equal(hooks.length, 2);
  assert.equal(hooks[0].tool, "executeAux4");
  assert.equal(hooks[0].order, 0);
  assert.equal(hooks[1].order, -5);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("loadHooks: missing file returns no hooks", () => {
  assert.deepEqual(loadHooks(""), []);
  assert.deepEqual(loadHooks("/no/such/file.json"), []);
});

test("matchHooks: order then installOrder, filtered by tool/command/params", () => {
  const hooks = loadHooks(writeHooksFile([
    { tool: "executeAux4", command: "a/run", order: 10, before: ["log:1"] },
    { tool: "executeAux4", command: "a/run", order: 1, before: ["log:2"] },
    { tool: "writeFile", command: "*/*", before: ["log:3"] },
    { tool: "executeAux4", command: "b/run", before: ["log:4"] }
  ]));
  const matched = matchHooks(hooks, "executeAux4", "a/run", {});
  assert.equal(matched.length, 2);
  assert.deepEqual(matched.map((h) => h.before[0]), ["log:2", "log:1"]);
});

test("resolveCommandPath: resolves a real installed command via --whereIsIt", () => {
  const commandPath = resolveCommandPath(["aux4", "version"]);
  assert.equal(commandPath, "aux4/version");
});

test("resolveCommandPath: unknown action resolves to null, never guessed", () => {
  const commandPath = resolveCommandPath(["definitely", "not", "a", "real", "command", "xyz123"]);
  assert.equal(commandPath, null);
});

function writeHooksFile(hooks) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-test-"));
  const file = path.join(tmp, "hooks.json");
  fs.writeFileSync(file, JSON.stringify({ hooks }));
  return file;
}

function fakeTool(name, impl) {
  let calls = 0;
  const fake = {
    description: "fake",
    schema: PASSTHROUGH_SCHEMA,
    invoke: async (args) => {
      calls++;
      return impl(args);
    }
  };
  return { fake, getCalls: () => calls };
}

test("wrapWithHooks: before hook blocks the call, real tool never runs", async () => {
  const { fake, getCalls } = fakeTool("executeAux4", () => "ran for real");
  const hooks = loadHooks(writeHooksFile([
    {
      tool: "executeAux4",
      command: "aux4/version",
      before: ["log:checking", "exit 1"]
    }
  ]));
  const wrapped = wrapWithHooks("executeAux4", fake, { hooks, request: "do it", historyFile: "", session: "s1" });
  const result = await wrapped.invoke({ command: "aux4 version" });
  assert.match(result, /^Blocked by hook:/);
  assert.equal(getCalls(), 0);
});

test("wrapWithHooks: a passing before hook lets the real tool run", async () => {
  const { fake, getCalls } = fakeTool("executeAux4", () => "ran for real");
  const hooks = loadHooks(writeHooksFile([
    { tool: "executeAux4", command: "aux4/version", before: ["log:ok ${__request}"] }
  ]));
  const wrapped = wrapWithHooks("executeAux4", fake, { hooks, request: "do it", historyFile: "", session: "s1" });
  const result = await wrapped.invoke({ command: "aux4 version" });
  assert.equal(result, "ran for real");
  assert.equal(getCalls(), 1);
});

test("wrapWithHooks: replace hook returns its own output, real tool never runs", async () => {
  const { fake, getCalls } = fakeTool("executeAux4", () => "ran for real");
  const hooks = loadHooks(writeHooksFile([
    { tool: "executeAux4", command: "aux4/version", replace: ["log:stubbed response"] }
  ]));
  const wrapped = wrapWithHooks("executeAux4", fake, { hooks, request: "", historyFile: "", session: "" });
  const result = await wrapped.invoke({ command: "aux4 version" });
  assert.equal(result, "stubbed response");
  assert.equal(getCalls(), 0);
});

test("wrapWithHooks: after hook with non-empty stdout replaces the result", async () => {
  const { fake } = fakeTool("executeAux4", () => "original result");
  const hooks = loadHooks(writeHooksFile([
    { tool: "executeAux4", command: "aux4/version", after: ["log:decorated result"] }
  ]));
  const wrapped = wrapWithHooks("executeAux4", fake, { hooks, request: "", historyFile: "", session: "" });
  const result = await wrapped.invoke({ command: "aux4 version" });
  assert.equal(result, "decorated result");
});

test("wrapWithHooks: after hook that prints nothing leaves the result untouched", async () => {
  const { fake } = fakeTool("executeAux4", () => "original result");
  const hooks = loadHooks(writeHooksFile([
    { tool: "executeAux4", command: "aux4/version", after: ["exit 0"] }
  ]));
  const wrapped = wrapWithHooks("executeAux4", fake, { hooks, request: "", historyFile: "", session: "" });
  const result = await wrapped.invoke({ command: "aux4 version" });
  assert.equal(result, "original result");
});

test("wrapWithHooks: error hook fires when the underlying tool throws", async () => {
  const fake = {
    description: "fake",
    schema: PASSTHROUGH_SCHEMA,
    invoke: async () => { throw new Error("boom"); }
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-test-"));
  const marker = path.join(tmp, "error-hook-ran");
  const hooks = loadHooks(writeHooksFile([
    { tool: "executeAux4", command: "aux4/version", error: [`file:${marker}:fired`] }
  ]));
  const wrapped = wrapWithHooks("executeAux4", fake, { hooks, request: "", historyFile: "", session: "" });
  await assert.rejects(() => wrapped.invoke({ command: "aux4 version" }), /boom/);
  assert.equal(fs.readFileSync(marker, "utf-8").trim(), "fired");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("wrapWithHooks: fail-closed when a before hook step crashes (non-zero exit)", async () => {
  const { fake, getCalls } = fakeTool("executeAux4", () => "ran for real");
  const hooks = loadHooks(writeHooksFile([
    { tool: "executeAux4", command: "aux4/version", before: ["exit 7"] }
  ]));
  const wrapped = wrapWithHooks("executeAux4", fake, { hooks, request: "", historyFile: "", session: "" });
  const result = await wrapped.invoke({ command: "aux4 version" });
  assert.match(result, /^Blocked by hook:/);
  assert.equal(getCalls(), 0);
});

test("wrapWithHooks: blocked profile:/stdin: executors in a hook step block the call", async () => {
  const { fake, getCalls } = fakeTool("executeAux4", () => "ran for real");
  const hooks = loadHooks(writeHooksFile([
    { tool: "executeAux4", command: "aux4/version", before: ["profile:deploy"] }
  ]));
  const wrapped = wrapWithHooks("executeAux4", fake, { hooks, request: "", historyFile: "", session: "" });
  const result = await wrapped.invoke({ command: "aux4 version" });
  assert.match(result, /not allowed in hooks/);
  assert.equal(getCalls(), 0);
});

test("wrapWithHooks: no hooks match -> tool returned unchanged, no wrapping overhead", async () => {
  const { fake } = fakeTool("executeAux4", () => "ran for real");
  const wrapped = wrapWithHooks("executeAux4", fake, { hooks: [], request: "", historyFile: "", session: "" });
  assert.equal(wrapped, fake);
});

test("wrapWithHooks: recursion guard -- isInsideHook reports depth while a hook phase runs", async () => {
  assert.equal(isInsideHook(), false);
  const { fake } = fakeTool("executeAux4", () => "ran for real");
  const hooks = loadHooks(writeHooksFile([
    { tool: "executeAux4", command: "aux4/version", before: ["log:checking"] }
  ]));
  const wrapped = wrapWithHooks("executeAux4", fake, { hooks, request: "", historyFile: "", session: "" });
  await wrapped.invoke({ command: "aux4 version" });
  assert.equal(isInsideHook(), false);
});

test("wrapWithHooks: a non-executeAux4 tool matches on tool name, params filter on its own args", async () => {
  const { fake, getCalls } = fakeTool("writeFile", () => "written");
  const hooks = loadHooks(writeHooksFile([
    { tool: "writeFile", params: { file: "secrets.env" }, before: ["exit 3"] }
  ]));
  const wrapped = wrapWithHooks("writeFile", fake, { hooks, request: "", historyFile: "", session: "" });

  const blocked = await wrapped.invoke({ file: "secrets.env", content: "x" });
  assert.match(blocked, /^Blocked by hook:/);
  assert.equal(getCalls(), 0);

  const allowed = await wrapped.invoke({ file: "notes.md", content: "x" });
  assert.equal(allowed, "written");
  assert.equal(getCalls(), 1);
});
