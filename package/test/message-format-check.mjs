// Keyless unit check for HARN-008: message-format (de)serialization round-trip.
//
// The agent stores its conversation as a plain JSON history file and, on every turn,
// must convert that stored JSON back into LangChain message objects (and convert the
// model's AIMessage-with-tool_calls / tool results back into the stored JSON shape).
// That round-trip is the most format-fragile part of the engine and previously had
// zero unit coverage because it was inlined in Prompt.js — which is not importable in
// plain node (a transitive doc-loader dependency throws at import). HARN-008 extracted
// the pure functions into src/lib/MessageFormat.js, so this script drives them
// directly: no API key, no model. Prints "MESSAGE-FORMAT OK" on success; exits
// non-zero otherwise.
import { AIMessage, ToolMessage, SystemMessage, HumanMessage } from "@langchain/core/messages";
import {
  deserializeMessage,
  recoverTruncatedImageArgs,
  simplifyMessageForHistory,
  simplifyMessagesForHistory,
  collapseSystemMessages
} from "../../src/lib/MessageFormat.js";

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL: " + msg);
    process.exit(1);
  }
}

// Simulate a full persist+reload: serialize the in-memory history to JSON exactly as
// saveHistory does (simplify -> stringify), then read it back (parse) the way history()
// does. Returns the reloaded plain-object message list.
function persistAndReload(messages) {
  const simplified = simplifyMessagesForHistory(messages);
  return JSON.parse(JSON.stringify({ messages: simplified, tokenUsage: {} })).messages;
}

// ---------------------------------------------------------------------------
// 1. assistant_with_tool round-trip (the model's tool turn) — the headline case.
//    A live AIMessage carrying tool_calls is stored, written to disk (JSON), reloaded,
//    and deserialized. The reconstructed message must be an AIMessage whose tool_calls
//    (id, name, args), text content, and additional_kwargs survive verbatim.
// ---------------------------------------------------------------------------
const toolCalls = [
  { id: "call_read_1", name: "readFile", args: { path: "src/app.js" }, type: "tool_call" },
  { id: "call_exec_2", name: "executeAux4", args: { command: "kb search x" }, type: "tool_call" }
];
const liveAssistant = new AIMessage({
  content: "let me look",
  tool_calls: toolCalls,
  additional_kwargs: { refusal: null }
});

// The engine stores this as { role: "assistant_with_tool", content: <AIMessage> }.
const storedAssistant = { role: "assistant_with_tool", content: liveAssistant, timestamp: 1720000000001 };

// --- 1a. On the SAME run (recursion) the content is still the live AIMessage (no
//         serialized `kwargs`); the spread branch must preserve everything.
const memRebuilt = deserializeMessage({ role: "assistant_with_tool", content: liveAssistant }, 0);
assert(memRebuilt instanceof AIMessage, "1a: in-memory assistant_with_tool -> AIMessage");
assert(memRebuilt._getType() === "ai", "1a: message type is ai");
assert(memRebuilt.tool_calls.length === 2, "1a: both tool_calls preserved in-memory");
assert(memRebuilt.tool_calls[0].id === "call_read_1" && memRebuilt.tool_calls[0].name === "readFile",
  "1a: first tool_call id + name preserved in-memory");
assert(memRebuilt.tool_calls[1].args.command === "kb search x", "1a: tool_call args preserved in-memory");

// --- 1b. After a disk round-trip the content is the serialized AIMessage (with
//         `kwargs`); the kwargs branch must reconstruct the same AIMessage.
const reloaded = persistAndReload([storedAssistant]);
assert(reloaded.length === 1, "1b: assistant_with_tool persisted (not filtered)");
assert(reloaded[0].role === "assistant_with_tool", "1b: role preserved on disk");
assert(reloaded[0].content && reloaded[0].content.kwargs, "1b: on-disk content is a serialized message with kwargs");
const diskRebuilt = deserializeMessage(reloaded[0], 0);
assert(diskRebuilt instanceof AIMessage, "1b: reloaded assistant_with_tool -> AIMessage");
assert(diskRebuilt.tool_calls.length === 2, "1b: both tool_calls survive the disk round-trip");
assert(diskRebuilt.tool_calls[0].id === "call_read_1", "1b: tool_call id survives disk round-trip");
assert(diskRebuilt.tool_calls[0].name === "readFile", "1b: tool_call name survives disk round-trip");
assert(diskRebuilt.tool_calls[1].name === "executeAux4", "1b: second tool_call name survives");
assert(diskRebuilt.tool_calls[1].args.command === "kb search x", "1b: tool_call args survive disk round-trip");
assert(diskRebuilt.content === "let me look", "1b: assistant text content survives");
assert(diskRebuilt.additional_kwargs && "refusal" in diskRebuilt.additional_kwargs, "1b: additional_kwargs survive");

// assistant_with_tool with no text content (content: null) must still yield the calls.
const noTextLive = new AIMessage({ content: "", tool_calls: [toolCalls[0]] });
const noTextReloaded = persistAndReload([{ role: "assistant_with_tool", content: noTextLive, timestamp: 2 }]);
const noTextRebuilt = deserializeMessage(noTextReloaded[0], 0);
assert(noTextRebuilt.tool_calls.length === 1 && noTextRebuilt.tool_calls[0].id === "call_read_1",
  "1c: content-less assistant_with_tool still carries its tool_call");

// ---------------------------------------------------------------------------
// 2. Tool-result round-trip. The current on-disk shape is the flat
//    { role, content, tool_call_id, name, timestamp } entry -> ToolMessage.
// ---------------------------------------------------------------------------
const toolEntry = {
  role: "tool",
  content: "file contents here",
  tool_call_id: "call_read_1",
  name: "readFile",
  timestamp: 1720000000002
};
const toolReloaded = persistAndReload([toolEntry]);
assert(toolReloaded[0].tool_call_id === "call_read_1" && toolReloaded[0].name === "readFile",
  "2: tool entry keeps tool_call_id + name through persist");
const toolMsg = deserializeMessage(toolReloaded[0], 0);
assert(toolMsg instanceof ToolMessage, "2: flat tool entry -> ToolMessage");
assert(toolMsg._getType() === "tool", "2: message type is tool");
assert(toolMsg.tool_call_id === "call_read_1", "2: ToolMessage tool_call_id links back to the call");
assert(toolMsg.name === "readFile", "2: ToolMessage name preserved");

// A tool entry may carry a recorded policy decision — it must survive persistence.
const toolWithPolicy = { ...toolEntry, policy: { decision: "allow", rule: "readFile:*" } };
const simplified = simplifyMessageForHistory(toolWithPolicy);
assert(simplified.policy && simplified.policy.decision === "allow", "2: policy decision preserved on tool entry");
assert(simplifyMessageForHistory({ role: "user", content: "hi" }).content === "hi",
  "2: non-tool messages pass through simplify unchanged");

// ---------------------------------------------------------------------------
// 3. Legacy tool shapes still deserialize (backward-compatible reads).
// ---------------------------------------------------------------------------
// 3a. Serialized ToolMessage under content.kwargs with a mixed content array
//     (text + image_url) — the image_url must be preserved, not dropped.
const legacyKwargs = {
  role: "tool",
  content: {
    kwargs: {
      content: [
        { type: "text", text: "here is the image" },
        { type: "image_url", image_url: { url: "data:image/png;base64,ZZZ" } }
      ],
      tool_call_id: "call_img_9",
      name: "generateImage"
    }
  }
};
const legacyKwargsMsg = deserializeMessage(legacyKwargs, 0);
assert(legacyKwargsMsg instanceof ToolMessage, "3a: legacy kwargs tool -> ToolMessage");
assert(legacyKwargsMsg.tool_call_id === "call_img_9", "3a: legacy tool_call_id preserved");
const legacyContent = legacyKwargsMsg.content;
assert(Array.isArray(legacyContent) && legacyContent.some(c => c.type === "image_url"),
  "3a: image_url content preserved through legacy deserialize");

// 3b. Nested content.content / content.tool_call_id fallback shape.
const legacyNested = {
  role: "tool",
  content: { content: "legacy text result", tool_call_id: "call_old_3", name: "oldTool" }
};
const legacyNestedMsg = deserializeMessage(legacyNested, 0);
assert(legacyNestedMsg.tool_call_id === "call_old_3" && legacyNestedMsg.name === "oldTool",
  "3b: nested legacy tool shape preserved");

// ---------------------------------------------------------------------------
// 4. Plain roles: system / assistant / user.
// ---------------------------------------------------------------------------
assert(deserializeMessage({ role: "system", content: "you are helpful" }, 0) instanceof SystemMessage,
  "4: system -> SystemMessage");
assert(deserializeMessage({ role: "assistant", content: "done" }, 0) instanceof AIMessage,
  "4: assistant -> AIMessage");
assert(deserializeMessage({ role: "user", content: "hello" }, 0) instanceof HumanMessage,
  "4: user -> HumanMessage");
// An unknown role falls through to HumanMessage.
assert(deserializeMessage({ role: "weird", content: "x" }, 0) instanceof HumanMessage,
  "4: unknown role -> HumanMessage");

// ---------------------------------------------------------------------------
// 5. Full history persistence path (assembly). Transient (untimestamped) system
//    instructions are dropped from the saved file; a timestamped system message is
//    kept; user/assistant/tool entries survive; ordering is preserved.
// ---------------------------------------------------------------------------
const fullHistory = [
  { role: "system", content: "base instructions (injected each run)" }, // no timestamp -> dropped
  { role: "system", content: "durable note", timestamp: 5 },            // timestamped -> kept
  { role: "user", content: "do the thing", timestamp: 6 },
  { role: "assistant_with_tool", content: liveAssistant, timestamp: 7 },
  { role: "tool", content: "ok", tool_call_id: "call_read_1", name: "readFile", timestamp: 8 },
  { role: "assistant", content: "all done", timestamp: 9 }
];
const persisted = persistAndReload(fullHistory);
const roles = persisted.map(m => m.role);
assert(!roles.includes("system") || persisted.filter(m => m.role === "system").length === 1,
  "5: exactly the timestamped system message is persisted");
assert(persisted.filter(m => m.role === "system").length === 1, "5: one system message kept");
assert(persisted[0].content === "durable note", "5: kept system message is the timestamped one");
assert(roles.join(",") === "system,user,assistant_with_tool,tool,assistant", "5: order preserved through persist");
// Every persisted entry must deserialize without throwing (assembly is valid).
persisted.forEach((m, i) => {
  const rebuilt = deserializeMessage(m, i);
  assert(rebuilt && typeof rebuilt._getType === "function", `5: entry ${i} deserializes to a message`);
});

// ---------------------------------------------------------------------------
// 6. collapseSystemMessages: merge all system messages into ONE leading message and
//    keep non-system messages in order (providers reject a non-leading system msg).
// ---------------------------------------------------------------------------
const collapsed = collapseSystemMessages([
  { role: "system", content: "A" },
  { role: "user", content: "u1" },
  { role: "system", content: "B" },
  { role: "assistant", content: "a1" }
], "SCHEMA");
assert(collapsed[0].role === "system", "6: collapsed output starts with a single system message");
assert(collapsed.filter(m => m.role === "system").length === 1, "6: exactly one system message after collapse");
assert(collapsed[0].content === "A\n\nB\n\nSCHEMA", "6: system contents joined + extraSystem appended last");
assert(collapsed.slice(1).map(m => m.role).join(",") === "user,assistant", "6: non-system order preserved");
// No system messages at all -> returned unchanged (no synthetic system message).
const noSys = collapseSystemMessages([{ role: "user", content: "hi" }]);
assert(noSys.length === 1 && noSys[0].role === "user", "6: no system messages -> list unchanged");

// ---------------------------------------------------------------------------
// 7. saveImage base64-truncation recovery.
// ---------------------------------------------------------------------------
const fullUrl = "data:image/png;base64," + "Q".repeat(2048);

// 7a. Truncated saveImage arg + a prior tool message carrying the full base64 (as a
//     serialized ToolMessage string) -> the full URL is spliced back in.
const priorToolStr = {
  role: "tool",
  content: JSON.stringify({ kwargs: { content: [{ type: "image_url", image_url: { url: fullUrl } }] } })
};
const truncatedCall = { name: "saveImage", args: { content: "data:image/png;base64,QQQ...", path: "out.png" } };
recoverTruncatedImageArgs([truncatedCall], [priorToolStr]);
assert(truncatedCall.args.content === fullUrl, "7a: truncated saveImage content recovered from prior tool message");

// 7b. Recovery also reads the nested content.content shape.
const priorNested = {
  role: "tool",
  content: { content: JSON.stringify({ kwargs: { content: [{ type: "image_url", image_url: { url: fullUrl } }] } }) }
};
const truncatedCall2 = { name: "saveImage", args: { content: "xxx..." } };
recoverTruncatedImageArgs([truncatedCall2], [priorNested]);
assert(truncatedCall2.args.content === fullUrl, "7b: recovery reads nested content.content shape");

// 7c. Well-formed (no "...") saveImage content is left untouched.
const cleanContent = "data:image/png;base64," + "R".repeat(64);
const cleanCall = { name: "saveImage", args: { content: cleanContent } };
recoverTruncatedImageArgs([cleanCall], [priorToolStr]);
assert(cleanCall.args.content === cleanContent, "7c: well-formed saveImage content is not modified");

// 7d. Truncated but no recoverable prior image -> content stays truncated (no crash,
//     no bogus substitution).
const orphanCall = { name: "saveImage", args: { content: "data:image/png;base64,AAA..." } };
recoverTruncatedImageArgs([orphanCall], [{ role: "user", content: "no image here" }]);
assert(orphanCall.args.content === "data:image/png;base64,AAA...", "7d: unrecoverable truncation left as-is");

// 7e. A truncated NON-saveImage tool call is never rewritten (only warned about).
const otherCall = { name: "readFile", args: { content: "big blob..." } };
recoverTruncatedImageArgs([otherCall], [priorToolStr]);
assert(otherCall.args.content === "big blob...", "7e: only saveImage calls are recovered");

// 7f. Malformed prior tool content (not JSON) is skipped without throwing.
const truncatedCall3 = { name: "saveImage", args: { content: "yyy..." } };
recoverTruncatedImageArgs([truncatedCall3], [{ role: "tool", content: "not json {" }, priorToolStr]);
assert(truncatedCall3.args.content === fullUrl, "7f: malformed tool content skipped, real one found");

// ---------------------------------------------------------------------------
// 8. Error path: a malformed entry surfaces its index so a corrupt history can be
//    located (the try/catch in deserializeMessage rethrows with the index).
// ---------------------------------------------------------------------------
let threw = false;
try {
  deserializeMessage({ role: "tool", content: null }, 42);
} catch (e) {
  threw = true;
  assert(/index 42/.test(e.message), "8: error message locates the bad entry by index");
}
assert(threw, "8: a malformed tool entry throws rather than silently corrupting the turn");

console.log("MESSAGE-FORMAT OK");
