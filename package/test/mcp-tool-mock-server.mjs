// Test-only helper: a minimal OpenAI-compatible mock server (plain node:http, no deps)
// standing in for api.openai.com's /chat/completions endpoint, scripted to prove the full MCP
// round trip without a real model or network: first request -> emit a tool_call for the MCP
// tool; second request (the tool result is now in the conversation) -> final answer that
// echoes the tool's result back, so the test can assert the loop actually ran end to end.
import http from "node:http";

const port = Number(process.argv[2] || 8940);

function readBody(req) {
  return new Promise(resolve => {
    let data = "";
    req.on("data", chunk => { data += chunk; });
    req.on("end", () => resolve(data));
  });
}

function chatCompletion(message, finishReason) {
  return JSON.stringify({
    id: "chatcmpl-mock",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "mock-mcp-model",
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    const body = await readBody(req);
    let parsed = {};
    try { parsed = JSON.parse(body); } catch {}

    const tools = Array.isArray(parsed.tools) ? parsed.tools : [];
    const toolNames = tools.map(t => t.function && t.function.name);
    const hasExecuteAux4 = toolNames.includes("executeAux4");
    const hasMcpEcho = toolNames.includes("mcpEcho");

    if (!hasExecuteAux4 || !hasMcpEcho) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(chatCompletion({
        role: "assistant",
        content: `MISSING_TOOLS:${toolNames.join(",") || "none"}`
      }, "stop"));
      return;
    }

    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    const toolResult = messages.find(m => m.role === "tool" && m.name === "mcpEcho");

    if (!toolResult) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(chatCompletion({
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call_mcp_1",
          type: "function",
          function: { name: "mcpEcho", arguments: JSON.stringify({ text: "ping" }) }
        }]
      }, "tool_calls"));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(chatCompletion({
      role: "assistant",
      content: `DONE:${toolResult.content}`
    }, "stop"));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`mcp-tool-mock-server listening on ${port}`);
});
