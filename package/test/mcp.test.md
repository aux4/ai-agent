# mcp

MCP servers are configured in an `mcp.json` file in the current working directory
(`{"mcpServers": {"<name>": {"command": ..., "args": [...]}}}`, the same shape
`@langchain/mcp-adapters`' `MultiServerMCPClient` consumes). Their tools are bound to the model
alongside `executeAux4`, for every `api` type, and are subject to the same permission/policy
checks as the built-ins (see `Tools.js#createMcpTools`).

## live LLM via mcp.json (docker, requires network + API key; skipped in CI)

Makes a live LLM call (with an MCP tool). Skipped when no LLM credentials are
present (CI); runs for real when `OPENAI_API_KEY` (or `AUX4_TEST_LLM`) is set.

```timeout
90000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "LLM-SKIPPED"; else aux4 ai agent ask "what time is it now in UTC? Please respond with just the time in HH:MM format." --config; fi
```

```expect:regex
^(\d{2}:\d{2}|LLM-SKIPPED)$
```

## MCP tool round trip against a local fixture (no docker, no API key, runs in CI)

`mcp-fixture-server.mjs` is a local stdio MCP server (via `@modelcontextprotocol/sdk`)
exposing one tool, `mcpEcho`, that echoes back `text` prefixed with `Echo: `.
`mcp-tool-mock-server.mjs` is a scripted OpenAI-compatible `/v1/chat/completions` mock: on the
first request it returns a `tool_calls` response calling `mcpEcho`; once the tool's result is
back in the conversation, it returns a final answer that embeds that result, proving the whole
loop ran — the tool was offered, called, and its result was used.

```beforeAll
node mcp-tool-mock-server.mjs 8940 >mcp-tool-mock-server.log 2>&1 &
echo $! > mcp-tool-mock-server.pid
sleep 2
```

```afterAll
kill "$(cat mcp-tool-mock-server.pid)" 2>/dev/null || true
rm -rf mcp-tool-mock-server.pid mcp-tool-mock-server.log
```

```file:mcp-fixture/mcp.json
{
  "mcpServers": {
    "fixture": {
      "command": "node",
      "args": ["../mcp-fixture-server.mjs"]
    }
  }
}
```

### should offer the MCP tool to the model, call it, and answer using its result

```timeout
60000
```

```execute
cd mcp-fixture && env -u OPENAI_API_KEY aux4 ai agent ask "use the mcp tool" --model '{"type":"openai","config":{"model":"mock-mcp-model","apiKey":"test-key","configuration":{"baseURL":"http://127.0.0.1:8940/v1"}}}'
```

```expect
DONE:Echo: ping
```

### should deny the MCP tool call when permissions deny it, and feed the denial back as the tool result

```timeout
60000
```

```execute
cd mcp-fixture && env -u OPENAI_API_KEY aux4 ai agent ask "use the mcp tool" --model '{"type":"openai","config":{"model":"mock-mcp-model","apiKey":"test-key","configuration":{"baseURL":"http://127.0.0.1:8940/v1"}}}' --permissions '{"deny":["mcp:mcpEcho"]}'
```

```expect:partial
DONE:Permission denied: MCP tool "mcpEcho" is not allowed by the permissions configuration.
```

### should not bind the MCP tool to the model when --tools excludes it

```timeout
60000
```

```execute
cd mcp-fixture && env -u OPENAI_API_KEY aux4 ai agent ask "use the mcp tool" --model '{"type":"openai","config":{"model":"mock-mcp-model","apiKey":"test-key","configuration":{"baseURL":"http://127.0.0.1:8940/v1"}}}' --tools executeAux4
```

```expect
MISSING_TOOLS:executeAux4
```

## api: chatgpt + MCP tool round trip against a local fixture (no docker, no API key, runs in CI)

Same round trip as above, but over the Responses API (`api: chatgpt`) using the existing
`chatgpt-mock-server.mjs`, proving MCP tools pass through `ResponsesApi#bindTools` (which also
applies the description-length/schema cleanup used for every tool) alongside `executeAux4`.

```file:chatgpt-home-mcp/.config/aux4-ai-agent/chatgpt-auth.json
{
  "issuer": "http://127.0.0.1:8932",
  "subject": "sub-123",
  "email": "person@example.com",
  "name": "Test Person",
  "client_id": "test-client-id",
  "ext_agent_host_id": "urn:uuid:test-host",
  "id_token": "fake.id.token",
  "access_token": "valid-access-token",
  "refresh_token": "valid-refresh-token",
  "token_type": "Bearer",
  "expires_at": 4102444800000,
  "scopes": ["openid", "profile", "email", "offline_access", "resource.invoke", "chatgpt.tokens.use.direct"],
  "saved_at": "2024-01-01T00:00:00.000Z"
}
```

```beforeAll
node chatgpt-mock-server.mjs 8932 >chatgpt-mock-server-mcp.log 2>&1 &
echo $! > chatgpt-mock-server-mcp.pid
sleep 2
```

```afterAll
kill "$(cat chatgpt-mock-server-mcp.pid)" 2>/dev/null || true
rm -rf chatgpt-mock-server-mcp.pid chatgpt-mock-server-mcp.log chatgpt-home-mcp
```

```file:mcp-fixture-chatgpt/mcp.json
{
  "mcpServers": {
    "fixture": {
      "command": "node",
      "args": ["../mcp-fixture-server.mjs"]
    }
  }
}
```

### should offer the MCP tool alongside executeAux4, call it, and answer using its result

```timeout
60000
```

```execute
cd mcp-fixture-chatgpt && HOME=../chatgpt-home-mcp AUX4_CHATGPT_RESOURCE=http://127.0.0.1:8932 env -u OPENAI_API_KEY aux4 ai agent ask --model '{"api":"chatgpt","config":{"model":"mock-mcp-tool-model"}}' "use the mcp tool"
```

```expect
DONE:Echo: ping
```
