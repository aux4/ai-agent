import assert from "node:assert/strict";
import test from "node:test";
import { extractChildTimings, internalTraceHeaders } from "../src/lib/Timing.js";

test("adds trace headers only for internal aux4 cloud endpoints", () => {
  process.env.AUX4_TRACE_ID = "abcdef0123456789";
  assert.deepEqual(
    internalTraceHeaders("https://aux4.on.dev.aux4.cloud/inference-broker/api/v1"),
    { "x-aux4-trace-id": "abcdef0123456789" }
  );
  assert.deepEqual(internalTraceHeaders("https://api.openai.com/v1"), {});
});

test("re-emits only normalized child timings for the current trace", () => {
  process.env.AUX4_TRACE_ID = "abcdef0123456789";
  let emitted = "";
  const original = process.stderr.write;
  process.stderr.write = value => { emitted += value; return true; };
  try {
    const remaining = extractChildTimings([
      JSON.stringify({ type: "aux4.timing", traceId: "abcdef0123456789", phase: "cloud", span: "cloud.remote", durationMs: 12.5, status: "ok", secret: "drop-me" }),
      JSON.stringify({ type: "aux4.timing", traceId: "another-trace", phase: "cloud", span: "cloud.remote", durationMs: 1, status: "ok" }),
      "ordinary diagnostic"
    ].join("\n"));
    assert.match(emitted, /"span":"cloud.remote"/);
    assert.doesNotMatch(emitted, /drop-me/);
    assert.match(remaining, /another-trace/);
    assert.match(remaining, /ordinary diagnostic/);
  } finally {
    process.stderr.write = original;
  }
});
