import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  commandResultFailed,
  mutationTarget,
  sameMutationTarget,
  wrapWithLoopDetection
} from "../src/lib/Tools.js";

const firstCreate = "google calendar events create --summary \"Vendor sync meeting\" --start \"2026-03-20T10:00:00Z\" --end \"2026-03-20T10:30:00Z\"";
const cosmeticVariant = "google calendar events create --calendarId primary --description \"Unique description 123\" --end \"2026-03-20T10:30:00Z\" --start \"2026-03-20T10:00:00Z\" --summary \"Vendor sync meeting\"";

test("mutationTarget identifies a change by command and stable target fields", () => {
  const first = mutationTarget("executeAux4", { command: firstCreate });
  const repeated = mutationTarget("executeAux4", { command: cosmeticVariant });
  const differentTime = mutationTarget("executeAux4", { command: cosmeticVariant.replace("10:00:00Z", "11:00:00Z") });

  assert.equal(sameMutationTarget(first, repeated), true);
  assert.equal(sameMutationTarget(first, differentTime), false);
  assert.equal(mutationTarget("executeAux4", { command: "google calendar events list --summary \"Vendor sync meeting\"" }), null);
});

test("a successful change is refused on a second call to the same target", async () => {
  let calls = 0;
  const guarded = wrapWithLoopDetection("executeAux4", {
    description: "execute aux4",
    schema: z.object({ command: z.string() }),
    invoke: async () => {
      calls++;
      return '{"kind":"calendar#event","status":"confirmed"}';
    }
  });

  assert.match(String(await guarded.invoke({ command: firstCreate })), /calendar#event/);
  const repeated = String(await guarded.invoke({ command: cosmeticVariant }));
  assert.match(repeated, /already succeeded in this run/);
  assert.equal(calls, 1);
});

test("a failed change does not block a corrected retry for that target", async () => {
  let calls = 0;
  const guarded = wrapWithLoopDetection("executeAux4", {
    description: "execute aux4",
    schema: z.object({ command: z.string() }),
    invoke: async () => {
      calls++;
      return calls === 1 ? "Error executing command: missing required parameter" : "created";
    }
  });

  assert.match(String(await guarded.invoke({ command: firstCreate })), /missing required parameter/);
  assert.equal(String(await guarded.invoke({ command: cosmeticVariant })), "created");
  assert.equal(calls, 2);
});

test("commandResultFailed recognizes executor failures, policy denials, and API error objects", () => {
  assert.equal(commandResultFailed("Not run: this action was already completed"), true);
  assert.equal(commandResultFailed("⛔ policy denied_action: denied"), true);
  assert.equal(commandResultFailed('{"error":{"message":"invalid event"}}'), true);
  assert.equal(commandResultFailed('{"kind":"calendar#event","status":"confirmed"}'), false);
});
