// Minimal OpenAI-compatible chat-completions server for the identical-failing-tool-call
// guard tests (HARN-029). No real model is called: it always re-issues the SAME
// executeAux4 tool call (a gmail "get" missing --messageId) on every turn, UNLESS
// `switchAt` says to swap in the FIXED call (adds --messageId) once a given number of
// tool results have already been seen -- that is what proves a CHANGED call is never
// blocked by the loop guard. Finalizes as soon as a tool result looks like success, or
// after MAX_TURNS tool rounds regardless (a safety cap so a broken guard cannot hang
// the test in an infinite loop).
import http from "node:http";

const port = Number(process.argv[2] || 58293);
// Number of prior tool results after which to switch to the FIXED call ("never" = always
// repeat the broken call).
const switchAtArg = process.argv[3] || "never";
const switchAt = switchAtArg === "never" ? Infinity : Number(switchAtArg);

const BROKEN = "aux4 google gmail get --id msg-ship-9f21";
const FIXED = "aux4 google gmail get --id msg-ship-9f21 --messageId msg-ship-9f21";
// A safety cap, not the expected path: the FIRST refusal / FIRST fixed-call success should
// already end the test. If a regression makes the guard stop refusing, this still bounds the
// loop so a broken test fails fast instead of hanging.
const MAX_TURNS = 3;

function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === "string" ? p : p?.text || "")).join("");
  }
  return "";
}

function send(res, body) {
  const json = JSON.stringify(body);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(json);
}

function toolCallResponse(id, command) {
  return {
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "gpt-test",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: `call_${id}`,
              type: "function",
              function: { name: "executeAux4", arguments: JSON.stringify({ command }) }
            }
          ]
        },
        finish_reason: "tool_calls"
      }
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  };
}

function finalResponse(id, text) {
  return {
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "gpt-test",
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  };
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(404);
    res.end();
    return;
  }

  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    let body;
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      body = {};
    }

    const messages = body.messages || [];
    const toolMessages = messages.filter((m) => m.role === "tool");
    const lastTool = toolMessages[toolMessages.length - 1];
    const lastText = lastTool ? extractText(lastTool.content) : "";

    if (lastText.startsWith("Email retrieved") || toolMessages.length >= MAX_TURNS) {
      send(res, finalResponse(`mock-final-${toolMessages.length}`, lastText || "giving up"));
      return;
    }

    const command = toolMessages.length >= switchAt ? FIXED : BROKEN;
    send(res, toolCallResponse(`mock-${toolMessages.length}`, command));
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`mock-openai-loop-server listening on ${port} switchAt=${switchAtArg}`);
});
