// Test-only fixture: a minimal local stdio MCP server (no docker, no network) exposing one
// tool -- mcpEcho -- so mcp.test.md can prove the MCP tool restoration end to end without any
// external dependency. Uses the @modelcontextprotocol/sdk already in node_modules (the same
// package Prompt.js's MultiServerMCPClient talks to) so the handshake is spec-accurate.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "mcp-fixture", version: "1.0.0" });

server.registerTool(
  "mcpEcho",
  {
    title: "Echo",
    description: "Echoes back the given text, prefixed with 'Echo: '",
    inputSchema: { text: z.string() }
  },
  async ({ text }) => ({
    content: [{ type: "text", text: `Echo: ${text}` }]
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
