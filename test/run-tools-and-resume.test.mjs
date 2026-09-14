import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  runToolsAndResumeExecutor,
  seedHistory
} from "../src/bin/commands/RunToolsAndResumeExecutor.js";

const seed = {
  messages: [
    { role: "user", content: "find it" },
    { role: "assistant_with_tool", content: { tool_calls: [{ id: "t1", name: "search", args: {} }] } }
  ],
  tokenUsage: { input: 1, output: 1, cached: 0, total: 2 }
};

test("seeds a new durable history without replacing a newer checkpoint", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aux4-history-seed-"));
  const history = path.join(dir, "history.json");
  try {
    assert.equal(await seedHistory(history, JSON.stringify(seed)), true);
    assert.deepEqual(JSON.parse(await readFile(history, "utf8")), seed);
    await writeFile(history, '{"messages":[{"role":"assistant","content":"newer"}]}');
    assert.equal(await seedHistory(history, JSON.stringify(seed)), false);
    assert.equal(JSON.parse(await readFile(history, "utf8")).messages[0].content, "newer");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runs one tool batch and passes its results directly to resume", async () => {
  const calls = [];
  const result = await runToolsAndResumeExecutor({
    history: "/tmp/session.json",
    historySeed: JSON.stringify(seed),
    toolCalls: '[{"id":"t1","name":"search","arguments":{"q":"aux4"}}]'
  }, {
    seedHistory: async (history, historySeed) => calls.push(["seed", history, historySeed]),
    runToolCalls: async params => {
      calls.push(["tools", params.toolCalls]);
      return [{ id: "t1", content: "found" }];
    },
    resumeExecutor: async params => {
      calls.push(["resume", params.toolResults]);
      return { status: "final", text: "answer" };
    }
  });

  assert.deepEqual(result, { status: "final", text: "answer" });
  assert.deepEqual(calls, [
    ["seed", "/tmp/session.json", JSON.stringify(seed)],
    ["tools", '[{"id":"t1","name":"search","arguments":{"q":"aux4"}}]'],
    ["resume", [{ id: "t1", content: "found" }]]
  ]);
});

test("rejects malformed history seeds before executing tools", async () => {
  await assert.rejects(
    runToolsAndResumeExecutor({
      history: "/tmp/session.json",
      historySeed: '{"notMessages":[]}',
      toolCalls: "[]"
    }, {
      runToolCalls: async () => { throw new Error("must not run"); },
      resumeExecutor: async () => {}
    }),
    /messages array/
  );
});
