import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readFile as fsReadFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import Prompt from "../src/lib/Prompt.js";

// A stand-in for a caller-minted presigned S3 URL: a single-key PUT/GET store.
// Exercises exactly the contract Prompt._pushCheckpoint/_pullCheckpoint use —
// PUT the whole payload, GET it back, 404 when nothing has been stored yet.
// Kept as one in-memory Map (never touches disk) so it stands in for durable
// storage that survives the *process* being killed, without a real bucket.
function startCheckpointStore() {
  const store = new Map();
  let putCount = 0;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      if (req.method === "PUT") {
        store.set(req.url, Buffer.concat(chunks).toString("utf8"));
        putCount++;
        res.writeHead(200);
        res.end();
      } else if (req.method === "GET") {
        const body = store.get(req.url);
        if (body === undefined) {
          res.writeHead(404);
          res.end();
        } else {
          res.writeHead(200);
          res.end(body);
        }
      } else {
        res.writeHead(405);
        res.end();
      }
    });
  });
  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        store,
        putCountRef: () => putCount,
        url: `http://127.0.0.1:${port}/session/turn-history.json`,
        close: () => new Promise(r => server.close(r))
      });
    });
  });
}

function newLocalPrompt(dir, { checkpointPutUrl, checkpointGetUrl } = {}) {
  // apiKey is never used -- these tests never call execute()/the model, only
  // the history/checkpoint plumbing, so constructing ChatOpenAI here makes no
  // network call.
  const prompt = new Prompt(
    { type: "openai", config: { apiKey: "test", model: "gpt-5-mini" } },
    {},
    { checkpointPutUrl, checkpointGetUrl }
  );
  return prompt;
}

test("normal path (no checkpoint URL) is unchanged: saveHistory writes locally and never calls fetch", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aux4-checkpoint-plain-"));
  const historyFile = path.join(dir, "history.json");
  try {
    const prompt = newLocalPrompt(dir);
    await prompt.history(historyFile);
    prompt.messages.push({ role: "user", content: "hello", timestamp: 1 });
    await prompt.saveHistory();

    const saved = JSON.parse(await fsReadFile(historyFile, "utf8"));
    assert.equal(saved.messages[0].content, "hello");
    assert.equal(prompt.checkpointPutUrl, null);
    assert.equal(prompt.checkpointGetUrl, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("each checkpoint is mirrored to the durable store as it happens, not just at the end", async () => {
  const { url, putCountRef, close } = await startCheckpointStore();
  const dir = await mkdtemp(path.join(os.tmpdir(), "aux4-checkpoint-push-"));
  const historyFile = path.join(dir, "history.json");
  try {
    const prompt = newLocalPrompt(dir, { checkpointPutUrl: url, checkpointGetUrl: url });
    await prompt.history(historyFile);

    prompt.messages.push({ role: "user", content: "turn 1", timestamp: 1 });
    await prompt.saveHistory();
    assert.equal(putCountRef(), 1, "checkpoint pushed after the first message, before any 'turn' completes");

    prompt.messages.push({ role: "assistant", content: "reply 1", timestamp: 2 });
    await prompt.saveHistory();
    assert.equal(putCountRef(), 2, "checkpoint pushed again after the second message");

    const local = JSON.parse(await fsReadFile(historyFile, "utf8"));
    assert.equal(local.messages.length, 2);
  } finally {
    await close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a turn killed mid-way leaves a recoverable transcript in the durable store", async () => {
  const { url, store, close } = await startCheckpointStore();
  const dirA = await mkdtemp(path.join(os.tmpdir(), "aux4-checkpoint-container-a-"));
  try {
    // Container A: local /tmp, checkpointing to the durable store as it goes.
    const historyFileA = path.join(dirA, "state", "agent-sessions", "run.json");
    const promptA = newLocalPrompt(dirA, { checkpointPutUrl: url, checkpointGetUrl: url });
    await promptA.history(historyFileA);

    promptA.messages.push({ role: "user", content: "do the long task", timestamp: 1 });
    await promptA.saveHistory();
    promptA.messages.push({
      role: "assistant_with_tool",
      content: { tool_calls: [{ id: "t1", name: "search", args: { q: "r2-3" } }] },
      timestamp: 2
    });
    await promptA.saveHistory();

    // Simulate the Lambda being killed here -- no more code from promptA ever
    // runs, no graceful shutdown, no final flush. What matters is what already
    // landed in the durable store BEFORE the kill.
    const key = new URL(url).pathname;
    assert.ok(store.has(key), "durable store already holds the checkpoint at the moment of the kill");
    const stored = JSON.parse(store.get(key));
    assert.equal(stored.messages.length, 2);
    assert.equal(stored.messages[1].role, "assistant_with_tool");
  } finally {
    await close();
    await rm(dirA, { recursive: true, force: true });
  }
});

test("a resumed turn continues from the checkpoint rather than restarting", async () => {
  const { url, close } = await startCheckpointStore();
  const dirA = await mkdtemp(path.join(os.tmpdir(), "aux4-checkpoint-container-a2-"));
  const dirB = await mkdtemp(path.join(os.tmpdir(), "aux4-checkpoint-container-b-"));
  try {
    // Container A checkpoints two messages, then is killed (same as above).
    const historyFileA = path.join(dirA, "state", "agent-sessions", "run.json");
    const promptA = newLocalPrompt(dirA, { checkpointPutUrl: url, checkpointGetUrl: url });
    await promptA.history(historyFileA);
    promptA.messages.push({ role: "user", content: "do the long task", timestamp: 1 });
    await promptA.saveHistory();
    promptA.messages.push({
      role: "assistant_with_tool",
      content: { tool_calls: [{ id: "t1", name: "search", args: { q: "r2-3" } }] },
      timestamp: 2
    });
    await promptA.saveHistory();

    // "Try again": a fresh container (fresh /tmp -- historyFileB does not
    // exist yet) with the SAME durable checkpoint URLs. Loading history must
    // pull the checkpoint down and continue from it, not start empty.
    const historyFileB = path.join(dirB, "state", "agent-sessions", "run.json");
    const promptB = newLocalPrompt(dirB, { checkpointPutUrl: url, checkpointGetUrl: url });
    await promptB.history(historyFileB);

    assert.equal(promptB.messages.length, 2, "resumed process rehydrates both checkpointed messages, not zero");
    assert.equal(promptB.messages[0].content, "do the long task");
    assert.equal(promptB.messages[1].role, "assistant_with_tool");

    // The resumed process can now keep going -- e.g. inject the tool result
    // for the pending call and checkpoint again -- exactly like an unbroken
    // process would, just in a new container.
    promptB.messages.push({ role: "tool", content: "found it", tool_call_id: "t1", timestamp: 3 });
    await promptB.saveHistory();
    const localB = JSON.parse(await fsReadFile(historyFileB, "utf8"));
    assert.equal(localB.messages.length, 3);
  } finally {
    await close();
    await rm(dirA, { recursive: true, force: true });
    await rm(dirB, { recursive: true, force: true });
  }
});

test("a fresh container with no checkpoint yet (nothing stored) falls through to empty history, not an error", async () => {
  const { url, close } = await startCheckpointStore();
  const dir = await mkdtemp(path.join(os.tmpdir(), "aux4-checkpoint-empty-"));
  try {
    const historyFile = path.join(dir, "state", "agent-sessions", "run.json");
    const prompt = newLocalPrompt(dir, { checkpointPutUrl: url, checkpointGetUrl: url });
    await prompt.history(historyFile); // 404 from the store -- nothing checkpointed yet
    assert.equal(prompt.messages.length, 0);
  } finally {
    await close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a warm container that already has local state is not clobbered by an older durable checkpoint", async () => {
  const { url, close } = await startCheckpointStore();
  const dir = await mkdtemp(path.join(os.tmpdir(), "aux4-checkpoint-warm-"));
  try {
    const historyFile = path.join(dir, "history.json");
    const promptA = newLocalPrompt(dir, { checkpointPutUrl: url, checkpointGetUrl: url });
    await promptA.history(historyFile);
    promptA.messages.push({ role: "user", content: "first message", timestamp: 1 });
    await promptA.saveHistory();

    // Same container, same local file still present (warm reuse) -- loading
    // history again must NOT pull from the durable store, since local /tmp is
    // already at least as fresh.
    const promptWarm = newLocalPrompt(dir, { checkpointPutUrl: url, checkpointGetUrl: url });
    await promptWarm.history(historyFile);
    assert.equal(promptWarm.messages.length, 1);
    assert.equal(promptWarm.messages[0].content, "first message");
  } finally {
    await close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("durable push failure does not fail the turn (best-effort, local write already succeeded)", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aux4-checkpoint-fail-"));
  const historyFile = path.join(dir, "history.json");
  try {
    // Nothing listening on this port -- every PUT rejects.
    const deadUrl = "http://127.0.0.1:1/session/history.json";
    const prompt = newLocalPrompt(dir, { checkpointPutUrl: deadUrl });
    await prompt.history(historyFile);
    prompt.messages.push({ role: "user", content: "hello", timestamp: 1 });
    await assert.doesNotReject(() => prompt.saveHistory());

    const saved = JSON.parse(await fsReadFile(historyFile, "utf8"));
    assert.equal(saved.messages[0].content, "hello");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("per-checkpoint durable-push overhead against a local store is small (measured, not asserted against a hard SLA)", async () => {
  const { url, close, putCountRef } = await startCheckpointStore();
  const dir = await mkdtemp(path.join(os.tmpdir(), "aux4-checkpoint-perf-"));
  try {
    const historyFile = path.join(dir, "history.json");

    const plain = newLocalPrompt(dir);
    await plain.history(historyFile);
    const N = 20;
    const plainStart = process.hrtime.bigint();
    for (let i = 0; i < N; i++) {
      plain.messages.push({ role: "user", content: `msg ${i}`, timestamp: i });
      await plain.saveHistory();
    }
    const plainMs = Number(process.hrtime.bigint() - plainStart) / 1e6;

    const historyFile2 = path.join(dir, "history2.json");
    const checkpointed = newLocalPrompt(dir, { checkpointPutUrl: url, checkpointGetUrl: url });
    await checkpointed.history(historyFile2);
    const ckStart = process.hrtime.bigint();
    for (let i = 0; i < N; i++) {
      checkpointed.messages.push({ role: "user", content: `msg ${i}`, timestamp: i });
      await checkpointed.saveHistory();
    }
    const ckMs = Number(process.hrtime.bigint() - ckStart) / 1e6;

    assert.equal(putCountRef(), N);
    const perCheckpointOverheadMs = (ckMs - plainMs) / N;
    console.log(
      `[checkpoint overhead] plain=${plainMs.toFixed(2)}ms total, with-durable-push=${ckMs.toFixed(2)}ms total, ` +
      `n=${N}, ~${perCheckpointOverheadMs.toFixed(2)}ms/checkpoint over a loopback HTTP PUT`
    );
    // No hard assertion on wall-clock latency (this is a loopback server, not
    // S3) -- the point of this test is to keep the measurement in the suite
    // so it's re-run on every change, not to gate on a number that would
    // really be about the network, not this code.
  } finally {
    await close();
    await rm(dir, { recursive: true, force: true });
  }
});
