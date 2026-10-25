// Minimal OpenAI-compatible chat-completions server for deterministic executeAux4
// tests. No real model is called: the FIRST request (no "tool" role message yet) is
// expected to carry a user message of the form "RUN: <command>" — the server replies
// with a single executeAux4 tool call for exactly that command. The SECOND request
// (after the tool result is appended) replies with the tool result content verbatim,
// so the test can assert on it without any model non-determinism.
import http from "node:http";

const port = Number(process.argv[2] || 58181);

// The OpenAI chat API accepts message content either as a plain string or as an array
// of content parts (e.g. [{type:"text", text:"..."}]); langchain sends the array form.
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
    const toolMessage = messages.find((m) => m.role === "tool");

    if (toolMessage) {
      send(res, {
        id: "chatcmpl-mock-2",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model || "gpt-test",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: extractText(toolMessage.content) },
            finish_reason: "stop"
          }
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      });
      return;
    }

    const userMessage = messages.find((m) => m.role === "user");
    const content = extractText(userMessage?.content);
    const match = content.match(/^RUN:([\s\S]*)$/);
    const command = match ? match[1].trim() : "version";

    send(res, {
      id: "chatcmpl-mock-1",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: body.model || "gpt-test",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "executeAux4", arguments: JSON.stringify({ command }) }
              }
            ]
          },
          finish_reason: "tool_calls"
        }
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    });
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`mock-openai-server listening on ${port}`);
});
