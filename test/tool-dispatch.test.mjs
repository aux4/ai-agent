import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { askExecutor } from "../src/bin/commands/AskExecutor.js";
import Prompt from "../src/lib/Prompt.js";
import { Policy } from "../src/lib/Policy.js";

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-agent-tool-dispatch-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  const callLog = path.join(dir, "calls.jsonl");
  const aux4 = path.join(bin, "aux4");
  fs.writeFileSync(aux4, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.at(-1) === "--whereIsIt") { console.log("aux4 sample → write"); process.exit(0); }
if (args[0] === "run-hook") {
  if (args.includes("--__response")) { console.log("after-hook-seen"); process.exit(0); }
  console.log("hook denied call"); process.exit(1);
}
fs.appendFileSync(${JSON.stringify(callLog)}, JSON.stringify(args) + "\\n");
console.log("executed");
`);
  fs.chmodSync(aux4, 0o755);
  const priorPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${priorPath || ""}`;
  t.after(() => { process.env.PATH = priorPath; });
  return { dir, callLog };
}

function seedHistory(file) {
  fs.writeFileSync(file, JSON.stringify({
    messages: [{ role: "user", content: "original request", timestamp: 1 }],
    tokenUsage: { input: 12, output: 4, cached: 2, total: 16 }
  }));
}

function readHistory(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

test("tool-only ask dispatch invokes exact args through bound tool and records a standard pair without a model", async t => {
  const { dir, callLog } = fixture(t);
  const history = path.join(dir, "history.json");
  const hooksFile = path.join(dir, "hooks.json");
  seedHistory(history);
  const command = `sample write --note "a quoted value" --code 'R-7'`;
  fs.writeFileSync(hooksFile, JSON.stringify({ hooks: [
    { tool: "executeAux4", command: "sample/write", after: ["log:run after hook ${__response}"] }
  ] }));

  await askExecutor({
    toolCall: JSON.stringify({ name: "executeAux4", args: { command } }),
    history,
    tools: "executeAux4",
    hooks: hooksFile,
    question: "original request",
    model: ""
  });

  const calls = fs.readFileSync(callLog, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(calls, [["sample", "write", "--note", "a quoted value", "--code", "R-7"]]);
  const saved = readHistory(history);
  assert.equal(saved.messages[0].content, "original request");
  const pair = saved.messages.slice(-2);
  assert.equal(pair[0].role, "assistant_with_tool");
  assert.equal(pair[1].role, "tool");
  const call = pair[0].content.kwargs.tool_calls[0];
  assert.equal(call.name, "executeAux4");
  assert.deepEqual(call.args, { command });
  assert.equal(pair[1].name, "executeAux4");
  assert.equal(pair[1].tool_call_id, call.id);
  assert.equal(pair[1].content, "after-hook-seen");
  assert.ok(call.id);
  assert.deepEqual(saved.tokenUsage, { input: 12, output: 4, cached: 2, total: 16 });
});

test("before-hook denial is recorded and prevents the command side effect", async t => {
  const { dir, callLog } = fixture(t);
  const history = path.join(dir, "history.json");
  const hooksFile = path.join(dir, "hooks.json");
  seedHistory(history);
  fs.writeFileSync(hooksFile, JSON.stringify({ hooks: [
    { tool: "executeAux4", command: "sample/write", before: ["exit 1"] }
  ] }));
  const prompt = new Prompt(null, {
    toolNames: "executeAux4",
    hooksFile,
    request: "original request",
    historyFile: history
  }, { toolOnly: true });
  await prompt.init();
  await prompt.history(history);
  const result = await prompt.invokeToolCall("executeAux4", { command: "aux4 sample write --code R-7" });
  await prompt.close();

  assert.match(result, /^Blocked by hook:/);
  assert.equal(fs.existsSync(callLog), false);
  const pair = readHistory(history).messages.slice(-2);
  assert.equal(pair[0].role, "assistant_with_tool");
  assert.equal(pair[1].role, "tool");
  assert.match(pair[1].content, /^Blocked by hook:/);
});

test("policy call budget denial uses the normal wrapper and does not execute the command", async t => {
  const { dir, callLog } = fixture(t);
  const history = path.join(dir, "history.json");
  seedHistory(history);
  const policy = Policy.load({ budget: { calls: 0 } });
  const prompt = new Prompt(null, { toolNames: "executeAux4", historyFile: history }, { toolOnly: true, policy });
  await prompt.init();
  await prompt.history(history);
  const result = await prompt.invokeToolCall("executeAux4", { command: "aux4 sample write --code R-7" });
  await prompt.close();

  assert.match(result, /budget exceeded/i);
  assert.equal(fs.existsSync(callLog), false);
  const pair = readHistory(history).messages.slice(-2);
  assert.equal(pair[0].role, "assistant_with_tool");
  assert.equal(pair[1].role, "tool");
  assert.equal(pair[1].policy.decision, "deny");
  assert.equal(pair[1].policy.trigger, "budget_exceeded");
});

test("a successive tool-only dispatch cannot reset a persisted call budget", async t => {
  const { dir, callLog } = fixture(t);
  const history = path.join(dir, "history.json");
  seedHistory(history);
  const firstPolicy = Policy.load({ budget: { calls: 1 } });
  const first = new Prompt(null, { toolNames: "executeAux4", historyFile: history }, { toolOnly: true, policy: firstPolicy });
  await first.init();
  await first.history(history);
  assert.equal(await first.invokeToolCall("executeAux4", { command: "sample write --code R-7" }), "executed\n");
  await first.close();

  const legacyHistory = readHistory(history);
  delete legacyHistory.toolCallCount;
  fs.writeFileSync(history, JSON.stringify(legacyHistory));

  const secondPolicy = Policy.load({ budget: { calls: 1 } });
  const second = new Prompt(null, { toolNames: "executeAux4", historyFile: history }, { toolOnly: true, policy: secondPolicy });
  await second.init();
  await second.history(history);
  assert.equal(second.toolCallCount, 1, "the prior consequential call is restored from history");
  const result = await second.invokeToolCall("executeAux4", { command: "sample write --code R-8" });
  await second.close();

  assert.match(result, /budget exceeded/i);
  assert.equal(fs.readFileSync(callLog, "utf8").trim().split("\n").length, 1);
  assert.equal(readHistory(history).toolCallCount, 2);
});

test("tool-only mode honors executeAux4 in a mixed allowlist without starting unused MCP tools", async t => {
  const { dir, callLog } = fixture(t);
  const history = path.join(dir, "history.json");
  seedHistory(history);
  const prompt = new Prompt(null, { toolNames: "executeAux4,configuredRemoteTool", historyFile: history }, { toolOnly: true });
  await prompt.init();
  assert.deepEqual(Object.keys(prompt.tools), ["executeAux4"]);
  assert.equal(await prompt.invokeToolCall("executeAux4", { command: "sample write --code R-7" }), "executed\n");
  await prompt.close();
  assert.equal(fs.readFileSync(callLog, "utf8").trim().split("\n").length, 1);
});

test("disabled, unknown, and malformed dispatches fail before any command runs", async t => {
  const { dir, callLog } = fixture(t);
  const prompt = new Prompt(null, { toolNames: "currentDateTime" }, { toolOnly: true });
  await assert.rejects(() => prompt.init(), /not enabled/);
  await assert.rejects(() => prompt.invokeToolCall("notATool", { command: "sample write" }), /restricted to executeAux4/);

  const enabled = new Prompt(null, { toolNames: "executeAux4" }, { toolOnly: true });
  await enabled.init();
  await assert.rejects(() => enabled.invokeToolCall("executeAux4", { command: "sample write", extra: true }), /Unexpected/);
  await assert.rejects(() => enabled.invokeToolCall("executeAux4", { timeout: "slow" }), /Invalid executeAux4 arguments/);
  await enabled.close();
  assert.equal(fs.existsSync(callLog), false);
});

test("malformed toolCall JSON is rejected before model resolution or command execution", async t => {
  const { callLog } = fixture(t);
  await assert.rejects(() => askExecutor({ toolCall: "{", model: "invalid-model", tools: "executeAux4" }), /Invalid --toolCall JSON/);
  assert.equal(fs.existsSync(callLog), false);
});
