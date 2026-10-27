# --tools allow-list (HARN-036)

`--tools` is documented as a comma-separated allow-list of tools to bind, but had no
implementation: every request bound all built-in tools regardless of the flag. These tests drive
the agent against the same deterministic mock OpenAI-compatible server used by the executeAux4
tests (`support/mock-openai-server.mjs`), which always issues a single `executeAux4` tool call —
so whether that call actually reaches the real tool is entirely controlled by `--tools`.

```beforeAll
nohup node support/mock-openai-server.mjs 58298 >mock-tools-server.log 2>&1 &
sleep 1
```

```afterAll
pkill -f "mock-openai-server.mjs 58298" || true
rm -f history.json mock-tools-server.log
```

```beforeEach
rm -f history.json
```

## --tools omitted keeps every built-in tool bound

### should run executeAux4 unaffected, same as before this flag existed

```timeout
30000
```

```execute
AUX4_BIN="$(command -v aux4)"; PATH="$PWD/support:$PATH" "$AUX4_BIN" ai agent ask --model '{"type":"openai","config":{"model":"gpt-test","apiKey":"sk-test","configuration":{"baseURL":"http://127.0.0.1:58298/v1"}}}' --history history.json 'RUN:version'
```

```expect:partial
["version"]
```

## --tools names executeAux4 explicitly

### should still run executeAux4 when it is in the allow-list

```timeout
30000
```

```execute
AUX4_BIN="$(command -v aux4)"; PATH="$PWD/support:$PATH" "$AUX4_BIN" ai agent ask --model '{"type":"openai","config":{"model":"gpt-test","apiKey":"sk-test","configuration":{"baseURL":"http://127.0.0.1:58298/v1"}}}' --history history.json --tools 'executeAux4,currentDateTime' 'RUN:version'
```

```expect:partial
["version"]
```

## --tools omits executeAux4

### should refuse the call as an unknown tool instead of ever running it

```timeout
30000
```

```execute
AUX4_BIN="$(command -v aux4)"; PATH="$PWD/support:$PATH" "$AUX4_BIN" ai agent ask --model '{"type":"openai","config":{"model":"gpt-test","apiKey":"sk-test","configuration":{"baseURL":"http://127.0.0.1:58298/v1"}}}' --history history.json --tools currentDateTime 'RUN:version'
```

```expect:partial
Error: Unknown tool "executeAux4"
```

## --tools names a tool that does not exist

### should fail fast with a clear error listing the valid tool names, before ever contacting the model

```timeout
30000
```

```execute
aux4 ai agent ask --model '{"type":"openai","config":{"model":"gpt-test","apiKey":"sk-test"}}' --tools notARealTool 'hello'
```

```error:partial
Unknown tool in --tools: notARealTool. Valid tools: *?
```
