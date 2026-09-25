import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, readFile as fsReadFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import Prompt from "../src/lib/Prompt.js";
import { compactMessages } from "../src/lib/Compaction.js";
import { archivePath, compactionTimestamp } from "../src/lib/CompactionArchive.js";

// AGC-019: auto-compaction keeps the originals. These tests never reach a real
// model: summarizeMessages takes a direct-API stand-in (the codexApi seam the
// codex path already uses), so the summary text is fixed and no network call is made.
const fakeSummarizer = { execute: async () => ({ answer: "SUMMARY OF EARLIER TURNS" }) };

function conversation(pairs) {
  const messages = [];
  for (let i = 0; i < pairs; i++) {
    messages.push({ role: "user", content: `question ${i}`, timestamp: 1000 + i * 2 });
    messages.push({ role: "assistant", content: `answer ${i}`, timestamp: 1001 + i * 2 });
  }
  return messages;
}

function newPrompt(compaction) {
  return new Prompt({ type: "openai", config: { apiKey: "test", model: "gpt-5-mini" } }, {}, { compaction });
}

const LOW_THRESHOLD = { contextWindow: 100, maxContextPercent: 10, keepLastMessages: 2 };

test("auto-compaction archives the full history next to the history file before compacting", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aux4-archive-"));
  const historyFile = path.join(dir, "abc123.json");
  try {
    const prompt = newPrompt(LOW_THRESHOLD);
    await prompt.history(historyFile);
    prompt.messages.push(...conversation(5));
    await prompt.saveHistory();

    await prompt._autoCompact(50, { codexApi: fakeSummarizer });
    await prompt.saveHistory(true);

    const archives = fs.readdirSync(dir).filter(name => name !== "abc123.json");
    assert.equal(archives.length, 1);
    assert.match(archives[0], /^abc123\.\d{14}\.json$/);

    const archived = JSON.parse(await fsReadFile(path.join(dir, archives[0]), "utf8"));
    assert.equal(archived.messages.length, 10);
    assert.equal(archived.messages[0].content, "question 0");

    const saved = JSON.parse(await fsReadFile(historyFile, "utf8"));
    assert.equal(saved.messages.length, 3);
    const summary = saved.messages[0];
    assert.equal(summary.compacted, true);
    assert.equal(summary.archive, archives[0]);
    assert.equal(summary.compactedCount, 8);
    assert.ok(!Number.isNaN(Date.parse(summary.compactedAt)));
    assert.match(summary.content, /SUMMARY OF EARLIER TURNS/);
    assert.equal(saved.messages[1].content, "question 4");
    assert.equal(saved.messages[2].content, "answer 4");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("below the threshold nothing is archived or compacted", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aux4-archive-none-"));
  const historyFile = path.join(dir, "h.json");
  try {
    const prompt = newPrompt(LOW_THRESHOLD);
    await prompt.history(historyFile);
    prompt.messages.push(...conversation(5));
    await prompt._autoCompact(5, { codexApi: fakeSummarizer });
    assert.equal(prompt.messages.length, 10);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("when the archive cannot be written the compaction is skipped (no loss)", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aux4-archive-ro-"));
  const historyFile = path.join(dir, "h.json");
  try {
    const prompt = newPrompt(LOW_THRESHOLD);
    await prompt.history(historyFile);
    prompt.messages.push(...conversation(5));
    await prompt.saveHistory();
    fs.chmodSync(dir, 0o555);
    await prompt._autoCompact(50, { codexApi: fakeSummarizer });
    fs.chmodSync(dir, 0o755);
    assert.equal(prompt.messages.length, 10);
    assert.ok(!prompt.messages.some(message => message.compacted));
  } finally {
    fs.chmodSync(dir, 0o755);
    await rm(dir, { recursive: true, force: true });
  }
});

test("a compaction that produces no summary leaves no orphan archive", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aux4-archive-orphan-"));
  const historyFile = path.join(dir, "h.json");
  try {
    const prompt = newPrompt({ ...LOW_THRESHOLD, keepLastMessages: 6 });
    await prompt.history(historyFile);
    prompt.messages.push(...conversation(2));
    await prompt.saveHistory();
    await prompt._autoCompact(50, { codexApi: fakeSummarizer });
    assert.deepEqual(fs.readdirSync(dir), ["h.json"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("archive names are UTC YYYYMMDDHHMMSS and never overwrite one another", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aux4-archive-name-"));
  try {
    const at = new Date(Date.UTC(2026, 8, 25, 7, 5, 9));
    assert.equal(compactionTimestamp(at), "20260925070509");
    const history = path.join(dir, "conv.json");
    const first = archivePath(history, at);
    assert.equal(path.basename(first), "conv.20260925070509.json");
    fs.writeFileSync(first, "{}");
    assert.equal(path.basename(archivePath(history, at)), "conv.20260925070509-1.json");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("condensed tool rounds are flagged so a chat can tell them from real replies", async () => {
  const messages = [
    ...conversation(4),
    { role: "user", content: "look it up", timestamp: 2000 },
    { role: "assistant_with_tool", content: { content: "", tool_calls: [{ id: "t1", name: "executeAux4", args: { command: "aux4 --help" } }] }, timestamp: 2001 },
    { role: "tool", content: "help text", tool_call_id: "t1", name: "executeAux4", timestamp: 2002 },
    { role: "assistant", content: "done", timestamp: 2003 }
  ];
  const compacted = await compactMessages(messages, {}, { keepLastMessages: 4, codexApi: fakeSummarizer });
  const summary = compacted.find(message => message.compacted);
  assert.equal(summary.compactedCount, 8);
  const condensed = compacted.find(message => message.condensed);
  assert.ok(condensed);
  assert.equal(condensed.role, "assistant");
  assert.match(condensed.content, /\[Tool calls\]/);
});

test("compaction never summarizes the latest user message (the question the answer replies to)", async () => {
  const messages = [
    ...conversation(3),
    { role: "user", content: "look it up", timestamp: 2000 },
    { role: "assistant_with_tool", content: { content: "", tool_calls: [{ id: "t1", name: "executeAux4", args: { command: "aux4 --help" } }] }, timestamp: 2001 },
    { role: "tool", content: "help text", tool_call_id: "t1", name: "executeAux4", timestamp: 2002 },
    { role: "assistant", content: "done", timestamp: 2003 }
  ];
  const compacted = await compactMessages(messages, {}, { keepLastMessages: 2, codexApi: fakeSummarizer });
  const summary = compacted.find(message => message.compacted);
  assert.equal(summary.compactedCount, 6);
  const tail = compacted.filter(message => !message.compacted);
  assert.equal(tail[0].role, "user");
  assert.equal(tail[0].content, "look it up");
  assert.equal(tail.at(-1).content, "done");
});
