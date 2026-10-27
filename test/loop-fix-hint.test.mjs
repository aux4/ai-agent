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

test("repeatFixHint spells out the corrected command from a Did-you-mean", () => {
  const result = "Error executing command: Command not found: `browser` under `aux4 ai agent`.\nAvailable commands here: ask, chat\nDid you mean: aux4 agent browser find";
  const hint = repeatFixHint(result, 'ai agent browser find --url http://x/orders --question "Which order?"');
  assert.match(hint, /Run executeAux4 with command: agent browser find --url http:\/\/x\/orders --question "Which order\?"/);
});

test("correctedCommand swaps the wrong leading words for the suggested path", async () => {
  const { correctedCommand } = await import("../src/lib/LoopHint.js");
  assert.equal(correctedCommand("ai agent browser run --url x --goal y", "agent browser run"), "agent browser run --url x --goal y");
  assert.equal(correctedCommand("foo bar --a 1", "agent browser find"), "");
});
