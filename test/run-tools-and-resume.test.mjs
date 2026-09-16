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

test("overwrites a durable file that is a strict prefix of the seed (turn N+1)", async () => {
  // The regression that hid SFA-147: on every tool-using turn after the first,
  // the durable session path already exists holding the PRE-turn conversation,
  // and the seed is that same conversation plus the new user question + the
  // assistant tool_calls checkpoint. The `wx` gate hit EEXIST and dropped the
  // seed; content-aware seeding must OVERWRITE with the richer seed.
  const dir = await mkdtemp(path.join(os.tmpdir(), "aux4-history-seed-prefix-"));
  const history = path.join(dir, "history.json");
  try {
    const priorTurn = {
      messages: [
        { role: "user", content: "Hi", timestamp: 1 },
        { role: "assistant", content: "Hello", timestamp: 2 }
      ],
      tokenUsage: { input: 2, output: 2, cached: 0, total: 4 }
    };
    const nextSeed = {
      messages: [
        { role: "user", content: "Hi", timestamp: 1 },
        { role: "assistant", content: "Hello", timestamp: 2 },
        { role: "user", content: "Do you have reference of r2-3?", timestamp: 3 },
        {
          role: "assistant_with_tool",
          content: { tool_calls: [{ id: "call_0", name: "executeAux4", args: {} }] },
          timestamp: 4
        }
      ],
      tokenUsage: { input: 6, output: 4, cached: 0, total: 10 }
    };
    await writeFile(history, JSON.stringify(priorTurn));
    // Unfixed (wx) code returns false and leaves the 2-message prior turn.
    assert.equal(await seedHistory(history, JSON.stringify(nextSeed)), true);
    assert.deepEqual(JSON.parse(await readFile(history, "utf8")), nextSeed);
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

test("decodes structured checkpoint and tool calls from base64-safe command arguments", async () => {
  const calls = [];
  const toolCalls = [{ id: "t1", name: "search", arguments: { q: "quoted value" } }];
  await runToolsAndResumeExecutor({
    history: "/tmp/session.json",
    historySeedBase64: Buffer.from(JSON.stringify(seed)).toString("base64"),
    toolCallsBase64: Buffer.from(JSON.stringify(toolCalls)).toString("base64")
  }, {
    seedHistory: async (_history, historySeed) => calls.push(["seed", JSON.parse(historySeed)]),
    runToolCalls: async params => {
      calls.push(["tools", JSON.parse(params.toolCalls)]);
      return [];
    },
    resumeExecutor: async () => ({ status: "final", text: "done" })
  });

  assert.deepEqual(calls, [["seed", seed], ["tools", toolCalls]]);
});

// Faithful replica of Prompt.injectToolResults reconstruction: pair each tool
// result to the last assistant_with_tool checkpoint in the loaded history and
// resolve its name from that pairing (falling back to the result's own name,
// then "unknown"). Kept dependency-free so it runs without the langchain-backed
// Prompt module; mirrors src/lib/Prompt.js injectToolResults exactly.
function reconstructResume(historyMessages, toolResults) {
  let toolCalls = [];
  for (let i = historyMessages.length - 1; i >= 0; i--) {
    const m = historyMessages[i];
    if (m.role === "assistant_with_tool") {
      const content = m.content || {};
      toolCalls = content.tool_calls || (content.kwargs && content.kwargs.tool_calls) || [];
      break;
    }
  }
  const nameById = {};
  for (const tc of toolCalls) {
    if (tc && tc.id) nameById[tc.id] = tc.name;
  }
  for (const tr of toolResults) {
    historyMessages.push({
      role: "tool",
      content: typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content),
      tool_call_id: tr.id,
      name: nameById[tr.id] || tr.name || "unknown"
    });
  }
  return historyMessages;
}

test("resumes an ongoing tool turn with the user question, paired tool result, and answer", async () => {
  // End-to-end at the executor seam: pre-populate the durable history with prior
  // turns, then run the executor with a seed that adds the user question and the
  // assistant tool_calls. On the unfixed (wx) bundle seedHistory drops the seed,
  // so resume reconstructs from the stale 2-message history -> no user question,
  // no assistant_with_tool, and the tool result orphaned as name "unknown".
  const dir = await mkdtemp(path.join(os.tmpdir(), "aux4-resume-turn-"));
  const history = path.join(dir, "history.json");
  try {
    const priorTurn = {
      messages: [
        { role: "user", content: "Hi", timestamp: 1 },
        { role: "assistant", content: "Hello", timestamp: 2 }
      ],
      tokenUsage: { input: 2, output: 2, cached: 0, total: 4 }
    };
    await writeFile(history, JSON.stringify(priorTurn));

    const turnSeed = {
      messages: [
        { role: "user", content: "Hi", timestamp: 1 },
        { role: "assistant", content: "Hello", timestamp: 2 },
        { role: "user", content: "Do you have reference of r2-3?", timestamp: 3 },
        {
          role: "assistant_with_tool",
          content: { tool_calls: [{ id: "call_0", name: "executeAux4", args: {} }] },
          timestamp: 4
        }
      ],
      tokenUsage: { input: 6, output: 4, cached: 0, total: 10 }
    };

    const result = await runToolsAndResumeExecutor({
      history,
      historySeed: JSON.stringify(turnSeed),
      toolCalls: JSON.stringify([{ id: "call_0", name: "executeAux4", arguments: {} }])
    }, {
      // Real seedHistory (the fix under test) is used — not stubbed.
      // Return WITHOUT a name so the tool-result name can only be correct if
      // seedHistory wrote the assistant_with_tool for reconstruction to pair.
      runToolCalls: async () => [{ id: "call_0", content: "r2 entry 3" }],
      resumeExecutor: async params => {
        const loaded = JSON.parse(await readFile(params.history, "utf8"));
        const messages = reconstructResume(loaded.messages, params.toolResults);
        messages.push({ role: "assistant", content: "Reference r2-3 is entry 3.", timestamp: 5 });
        await writeFile(params.history, JSON.stringify({ messages }));
        return { status: "final", text: "Reference r2-3 is entry 3." };
      }
    });

    assert.deepEqual(result, { status: "final", text: "Reference r2-3 is entry 3." });

    const finalMessages = JSON.parse(await readFile(history, "utf8")).messages;
    const userQuestion = finalMessages.find(
      m => m.role === "user" && m.content === "Do you have reference of r2-3?"
    );
    assert.ok(userQuestion, "the user question must be present in resumed history");

    const assistantToolCall = finalMessages.find(m => m.role === "assistant_with_tool");
    assert.ok(assistantToolCall, "the assistant tool_calls checkpoint must be present");

    const toolResult = finalMessages.find(m => m.role === "tool");
    assert.ok(toolResult, "the tool result must be present");
    assert.equal(toolResult.name, "executeAux4");
    assert.notEqual(toolResult.name, "unknown");

    const finalAnswer = finalMessages[finalMessages.length - 1];
    assert.equal(finalAnswer.role, "assistant");
    assert.equal(finalAnswer.content, "Reference r2-3 is entry 3.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
