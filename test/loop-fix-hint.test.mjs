import { test } from "node:test";
import assert from "node:assert/strict";
import { repeatFixHint } from "../src/lib/LoopHint.js";

test("repeatFixHint names the missing flag from aux4's own error", () => {
  const hint = repeatFixHint("Error executing command: Missing required parameter --messageId: The message ID to retrieve");
  assert.match(hint, /needs --messageId <value>/);
  assert.match(hint, /rename that flag to --messageId/);
});

test("repeatFixHint names the suggested flag for an unknown parameter", () => {
  const hint = repeatFixHint("Error executing command: Unknown parameter --event-id, did you mean --eventId?");
  assert.equal(hint, "The error names the fix: use --eventId instead of --event-id, then run it again.");
});

test("repeatFixHint says nothing for other repeated results", () => {
  assert.equal(repeatFixHint("{\"status\":\"ok\"}"), "");
  assert.equal(repeatFixHint(""), "");
});
