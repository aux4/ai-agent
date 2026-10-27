import { test } from "node:test";
import assert from "node:assert/strict";
import { parseToolsAllowList, applyToolsAllowList } from "../src/lib/ToolBindings.js";
import { createTools } from "../src/lib/Tools.js";

// HARN-036 bug 1: `--tools` was documented ("comma-separated allow-list of tools to bind") but
// had no implementation -- every request bound all built-in tools regardless of the flag. These
// tests cover the pure allow-list helpers (parseToolsAllowList / applyToolsAllowList) that
// Prompt.js#init now applies to the pool it got from createTools()/MCP before binding to the
// model.

test("parseToolsAllowList: unset/empty/whitespace-only means no filtering (null)", () => {
  assert.equal(parseToolsAllowList(undefined), null);
  assert.equal(parseToolsAllowList(""), null);
  assert.equal(parseToolsAllowList("   "), null);
  assert.equal(parseToolsAllowList(","), null);
});

test("parseToolsAllowList: trims a comma list and drops empty entries", () => {
  assert.deepEqual(parseToolsAllowList("executeAux4, currentDateTime ,, readFile"), [
    "executeAux4",
    "currentDateTime",
    "readFile"
  ]);
});

test("applyToolsAllowList: no allow list (null) returns the pools unchanged", () => {
  const builtins = createTools({});
  const mcpTools = [{ name: "mcpThing" }];
  const result = applyToolsAllowList(null, builtins, mcpTools);
  assert.equal(result.builtinTools, builtins);
  assert.equal(result.mcpTools, mcpTools);
});

test("applyToolsAllowList: keeps only the named built-in tools", () => {
  const builtins = createTools({});
  const result = applyToolsAllowList(["executeAux4", "currentDateTime"], builtins, []);
  assert.deepEqual(Object.keys(result.builtinTools).sort(), ["currentDateTime", "executeAux4"]);
  assert.equal(result.mcpTools.length, 0);
});

test("applyToolsAllowList: unknown tool name throws, listing the valid names", () => {
  const builtins = createTools({});
  assert.throws(
    () => applyToolsAllowList(["executeAux4", "notARealTool"], builtins, []),
    (err) => {
      assert.match(err.message, /notARealTool/);
      assert.match(err.message, /executeAux4/);
      assert.match(err.message, /Valid tools:/);
      return true;
    }
  );
});

test("applyToolsAllowList: MCP tools are matched by name in the same flat namespace", () => {
  const builtins = createTools({});
  const mcpTools = [{ name: "mcpA" }, { name: "mcpB" }];

  // Named -> kept.
  const kept = applyToolsAllowList(["mcpA"], builtins, mcpTools);
  assert.deepEqual(kept.builtinTools, {});
  assert.deepEqual(kept.mcpTools.map((t) => t.name), ["mcpA"]);

  // Not named -> dropped, same as an unnamed built-in would be.
  const dropped = applyToolsAllowList(["executeAux4"], builtins, mcpTools);
  assert.equal(dropped.mcpTools.length, 0);
});

test("applyToolsAllowList: an MCP tool name omitted from a given list is a valid name, just not kept (no throw)", () => {
  const builtins = createTools({});
  const mcpTools = [{ name: "mcpA" }];
  const result = applyToolsAllowList(["executeAux4"], builtins, mcpTools);
  assert.equal(result.mcpTools.length, 0);
  assert.ok(result.builtinTools.executeAux4);
});

import { callShape, resultShape } from "../src/lib/Tools.js";

test("callShape ignores entered values and session ids, keeps the action", () => {
  const a = callShape("executeAux4", { command: "agent browser run --session 'ff8e1d4b' --goal 'Find x' --field 'Employee id=12345'" });
  const b = callShape("executeAux4", { command: "agent browser run --session 'aa11bb22' --goal 'Find x' --field \"Employee id=999\"" });
  const c = callShape("executeAux4", { command: "agent browser run --session 'aa11bb22' --goal 'Find y' --field 'Employee id=999'" });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(resultShape('{"status":"needs-input","session":"ff8e1d4b"}'), resultShape('{"status":"needs-input","session":"aa11bb22"}'));
});
