// Test-only fixture: a minimal local stdio MCP server, hand-rolled JSON-RPC 2.0 over
// newline-delimited stdin/stdout (no dependencies), exposing one tool -- mcpEcho -- so
// mcp.test.md can prove the MCP tool restoration end to end without any external process,
// docker, or network. Implements just enough of the protocol (initialize, tools/list,
// tools/call) for @langchain/mcp-adapters' MultiServerMCPClient (built on
// @modelcontextprotocol/sdk's Client) to talk to it.
//
// A version built on @modelcontextprotocol/sdk's own McpServer/StdioServerTransport was tried
// first and worked locally, but hung indefinitely in CI (both macOS and Linux runners) for
// reasons that didn't reproduce locally -- this dependency-free server avoids that failure
// mode entirely while still exercising the real client-side code path.
import readline from "node:readline";

const PROTOCOL_VERSION = "2025-06-18";

const TOOLS = [
  {
    name: "mcpEcho",
    description: "Echoes back the given text, prefixed with 'Echo: '",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"]
    }
  }
];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }

  // Notifications (no id) never get a response.
  if (message.id === undefined) return;

  switch (message.method) {
    case "initialize":
      reply(message.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "mcp-fixture", version: "1.0.0" }
      });
      break;

    case "tools/list":
      reply(message.id, { tools: TOOLS });
      break;

    case "tools/call": {
      const { name, arguments: args = {} } = message.params || {};
      if (name === "mcpEcho") {
        reply(message.id, { content: [{ type: "text", text: `Echo: ${args.text}` }] });
      } else {
        reply(message.id, { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true });
      }
      break;
    }

    case "ping":
      reply(message.id, {});
      break;

    default:
      send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
  }
});
