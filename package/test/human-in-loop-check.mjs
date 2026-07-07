// Keyless unit check for HARN-005: non-TTY human-in-the-loop parking + resume.
//
// The askUser tool and permission `ask:` gates parked-vs-resumed decisions all flow
// through the pure helpers in src/lib/HumanInLoop.js (the same functions Tools.js and
// Prompt.js call). Tools.js/Prompt.js cannot be imported in plain node (a transitive
// doc-loader dependency breaks at import), so this script exercises the shared park
// primitives directly — no API key, no model, no TTY. Prints "HUMAN-IN-LOOP OK" on
// success; exits non-zero otherwise.
import {
  PARK_SENTINEL,
  PENDING_EXIT_CODE,
  makeParkSignal,
  isParkSignal,
  parseParkSignal,
  questionKey,
  commandKey,
  fileKey,
  isAffirmative,
  resolveHumanGate,
  findParkedResult,
  applyPendingResolution,
  emitPendingMarker
} from "../../src/lib/HumanInLoop.js";

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL: " + msg);
    process.exit(1);
  }
}

// 1. Park signal round-trips the full pending-question record verbatim.
const record = {
  kind: "question",
  tool: "askUser",
  key: questionKey("Which environment should I deploy to?"),
  question: "Which environment should I deploy to?",
  args: { question: "Which environment should I deploy to?" },
  timestamp: 1720000000000
};
const signal = makeParkSignal(record);
assert(signal.startsWith(PARK_SENTINEL), "park signal must start with the sentinel");
assert(isParkSignal(signal), "isParkSignal must detect a park signal");
assert(!isParkSignal("User responded: prod"), "plain tool output is not a park signal");
assert(!isParkSignal(undefined), "non-string is not a park signal");
const parsed = parseParkSignal(signal);
assert(parsed && parsed.question === record.question, "parsed record keeps the question");
assert(parsed.key === record.key && parsed.tool === "askUser", "parsed record keeps key + tool");
assert(parseParkSignal("not a signal") === null, "parseParkSignal returns null for non-signals");

// 2. Resolution keys are stable and content-derived (identical park run vs resume run).
assert(questionKey("go?") === "ask:go?", "questionKey format");
assert(commandKey("kb add --content x") === "cmd:kb add --content x", "commandKey format");
assert(fileKey("write", "/tmp/a.txt") === "file:write:/tmp/a.txt", "fileKey format");

// 3. Affirmative parsing: recognized yes-words true; empty/unknown/no => false (safe).
for (const yes of ["y", "Yes", "ALLOW", "approve", "ok", "grant", "true", "  yes  "]) {
  assert(isAffirmative(yes) === true, `"${yes}" must be affirmative`);
}
for (const no of ["", "  ", "n", "no", "deny", "nope", "maybe", undefined, null]) {
  assert(isAffirmative(no) === false, `"${no}" must NOT be affirmative`);
}

// 4. resolveHumanGate four-way branch — the core no-TTY decision.
assert(resolveHumanGate({ resolution: { answer: "prod" }, hasTTY: false, mode: "park" }).action === "resolved",
  "an existing resolution resumes (resolved) regardless of TTY/mode");
assert(resolveHumanGate({ resolution: null, hasTTY: true, mode: "park" }).action === "prompt",
  "a TTY prompts");
assert(resolveHumanGate({ resolution: null, hasTTY: false, mode: "auto" }).action === "auto",
  "no TTY + auto mode uses legacy auto behavior");
assert(resolveHumanGate({ resolution: null, hasTTY: false, mode: "park" }).action === "park",
  "no TTY + park mode parks");
assert(resolveHumanGate({ resolution: null, hasTTY: false, mode: undefined }).action === "park",
  "park is the default mode when unset");

// 5. Engine-side park detection + resume feed (what Prompt.execute / resolvePending do).
//    Simulate a tool-results batch where askUser parked while a sibling tool succeeded.
const parkedEntry = {
  role: "tool",
  content: "[Paused — awaiting the user's answer to: Which environment should I deploy to?]",
  tool_call_id: "call_ask_1",
  name: "askUser",
  timestamp: Date.now(),
  parked: { ...record, toolCallId: "call_ask_1" }
};
const okEntry = { role: "tool", content: "done", tool_call_id: "call_read_1", name: "readFile" };
const toolResults = [okEntry, parkedEntry];

const found = findParkedResult(toolResults);
assert(found === parkedEntry, "findParkedResult returns the parked entry");
assert(findParkedResult([okEntry]) === null, "findParkedResult returns null when nothing parked");

// The pending record is what gets persisted to history and surfaced to a supervisor.
const pending = found.parked;
assert(pending.toolCallId === "call_ask_1", "pending record carries the waiting tool_call_id");

// Resume: the user's answer is fed back to the waiting tool call by tool_call_id.
const messages = [
  { role: "assistant_with_tool", content: {} },
  { ...parkedEntry }
];
const applied = applyPendingResolution(messages, pending.toolCallId, "User responded: prod");
assert(applied === true, "applyPendingResolution finds and updates the waiting message");
assert(messages[1].content === "User responded: prod", "the answer replaced the placeholder");
assert(messages[1].parked === undefined, "the parked marker is cleared after resolution");
assert(applyPendingResolution(messages, "no_such_id", "x") === false,
  "applyPendingResolution returns false when the waiting message is absent");

// 6. The structured pending marker is a single parseable JSON line for a supervisor.
const permissionRecord = {
  kind: "permission",
  tool: "executeAux4",
  key: commandKey("jobs run deploy"),
  question: "The agent wants to run: aux4 jobs run deploy\nAllow?",
  command: "jobs run deploy",
  timestamp: 1720000000000
};
let captured = "";
const fakeStream = { write: chunk => { captured += chunk; } };
emitPendingMarker(permissionRecord, fakeStream);
assert(captured.startsWith("AUX4_PENDING_QUESTION "), "marker line is prefixed for grepping");
assert(captured.endsWith("\n"), "marker is a single line");
const markerJson = JSON.parse(captured.slice("AUX4_PENDING_QUESTION ".length));
assert(markerJson.type === "pending_question", "marker type field");
assert(markerJson.kind === "permission" && markerJson.tool === "executeAux4", "marker kind + tool");
assert(markerJson.command === "jobs run deploy", "permission marker includes the command");
assert(markerJson.key === permissionRecord.key, "marker includes the resolution key");

// 7. The pending exit code is distinguishable from success/error.
assert(PENDING_EXIT_CODE === 10, "pending exit code is 10");

console.log("HUMAN-IN-LOOP OK");
