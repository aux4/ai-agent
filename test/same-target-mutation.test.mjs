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

test("parallel changes to the same target reserve it before the first call completes", async () => {
  let calls = 0;
  let finishFirst;
  const guarded = wrapWithLoopDetection("executeAux4", {
    description: "execute aux4",
    schema: z.object({ command: z.string() }),
    invoke: async () => {
      calls++;
      return new Promise(resolve => { finishFirst = resolve; });
    }
  });

  const first = guarded.invoke({ command: firstCreate });
  await new Promise(resolve => setImmediate(resolve));
  const repeated = String(await guarded.invoke({ command: cosmeticVariant }));
  assert.match(repeated, /already running/);
  assert.equal(calls, 1);

  finishFirst('{"kind":"calendar#event","status":"confirmed"}');
  assert.match(String(await first), /calendar#event/);
});

test("identical successful evidence across changed read flags stops before a third call", async () => {
  let calls = 0;
  const help = "list\nList records.\nget\nGet one record.";
  const guarded = wrapWithLoopDetection("executeAux4", {
    description: "execute aux4",
    schema: z.object({ command: z.string() }),
    invoke: async () => { calls++; return help; }
  });

  await guarded.invoke({ command: "google calendar events --maxResults 1" });
  await guarded.invoke({ command: "google calendar events --singleEvents true" });
  const third = String(await guarded.invoke({ command: "google calendar events --timeMin 2026-01-01T00:00:00Z" }));

  assert.match(third, /identical evidence twice after different arguments/);
  assert.match(third, /run one of the listed subcommands/);
  assert.equal(calls, 2);
});

test("different evidence and goal-level browser runs are still allowed", async () => {
  let calls = 0;
  const guarded = wrapWithLoopDetection("executeAux4", {
    description: "execute aux4",
    schema: z.object({ command: z.string() }),
    invoke: async () => `result-${++calls}`
  });

  await guarded.invoke({ command: "google calendar events list --query first" });
  await guarded.invoke({ command: "google calendar events list --query second" });
  await guarded.invoke({ command: "google calendar events list --query third" });
  assert.equal(calls, 3);

  await guarded.invoke({ command: "agent browser run --url http://example.test --goal first" });
  await guarded.invoke({ command: "agent browser run --url http://example.test --goal second" });
  await guarded.invoke({ command: "agent browser run --url http://example.test --goal third" });
  assert.equal(calls, 6);
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
