# repeated failing tool-call guard (SFA-159)

A tool error is just text to the model, so a broken command (e.g. a missing
required flag) can be re-planned unchanged indefinitely — one incident reissued
the identical failing call 71 times over 6m44s. When the same tool call
(name+args) produces the byte-identical result three times in a row, `resume`
appends synthetic guidance to the latest tool result telling the model not to
retry verbatim, so it self-corrects. Legitimate retries that change arguments,
and calls that finally succeed, are unaffected.

These tests make a live LLM call on `resume` and are skipped automatically
unless `AUX4_TEST_MLX` is set. The assertion is on the persisted history (the
guidance is injected before the model turn), so it is deterministic regardless
of what the model then does.

```file:loop-config.yaml
config:
  agent:
    model:
      type: openai
      config:
        model: mlx-community/gemma-4-e4b-it-bf16
        apiKey: mlx-local
        maxTokens: 256
        temperature: 0
        configuration:
          baseURL: http://localhost:8381/v1
```

```file:AGENTS.md
You are an assistant. Use the tools provided. If a tool keeps failing the same
way, stop and report the error instead of retrying it.
```

## the third identical failing round gets loop-breaking guidance

### should append the repeated-failure marker to the third identical error result

```timeout
120000
```

```file:loop3.json
{
  "messages": [
    { "role": "user", "content": "mark it reviewed", "timestamp": 1 },
    { "role": "assistant_with_tool", "content": { "content": "", "tool_calls": [ { "id": "id1", "name": "executeAux4", "args": { "command": "kb update r2-3" }, "type": "tool_call" } ] }, "timestamp": 2 },
    { "role": "tool", "content": "Error executing tool \"executeAux4\": Content is required (use --content or --file)", "tool_call_id": "id1", "name": "executeAux4", "timestamp": 3 },
    { "role": "assistant_with_tool", "content": { "content": "", "tool_calls": [ { "id": "id2", "name": "executeAux4", "args": { "command": "kb update r2-3" }, "type": "tool_call" } ] }, "timestamp": 4 },
    { "role": "tool", "content": "Error executing tool \"executeAux4\": Content is required (use --content or --file)", "tool_call_id": "id2", "name": "executeAux4", "timestamp": 5 },
    { "role": "assistant_with_tool", "content": { "content": "", "tool_calls": [ { "id": "id3", "name": "executeAux4", "args": { "command": "kb update r2-3" }, "type": "tool_call" } ] }, "timestamp": 6 }
  ],
  "tokenUsage": {}
}
```

```file:loop3-tr.json
[
  { "id": "id3", "content": "Error executing tool \"executeAux4\": Content is required (use --content or --file)" }
]
```

```execute
if [ -z "$AUX4_TEST_MLX" ]; then echo 'guidance present: true'; else aux4 ai agent resume --configFile loop-config.yaml --config agent --instructions AGENTS.md --history loop3.json --tools executeAux4 --toolResults loop3-tr.json >/dev/null 2>&1; node -e 'const h=require("./loop3.json");const t=h.messages.filter(m=>m.role==="tool");const l=t[t.length-1];console.log("guidance present: "+(l.content.includes("[agent:repeated-failure]") && l.content.includes("3 times in a row")));'; fi
```

```expect:partial
guidance present: true
```

## a retry with different arguments is not flagged

### should NOT append guidance when the third call changes its arguments

```timeout
120000
```

```file:diff3.json
{
  "messages": [
    { "role": "user", "content": "mark it reviewed", "timestamp": 1 },
    { "role": "assistant_with_tool", "content": { "content": "", "tool_calls": [ { "id": "id1", "name": "executeAux4", "args": { "command": "kb update r2-3" }, "type": "tool_call" } ] }, "timestamp": 2 },
    { "role": "tool", "content": "Error executing tool \"executeAux4\": Content is required (use --content or --file)", "tool_call_id": "id1", "name": "executeAux4", "timestamp": 3 },
    { "role": "assistant_with_tool", "content": { "content": "", "tool_calls": [ { "id": "id2", "name": "executeAux4", "args": { "command": "kb update r2-3" }, "type": "tool_call" } ] }, "timestamp": 4 },
    { "role": "tool", "content": "Error executing tool \"executeAux4\": Content is required (use --content or --file)", "tool_call_id": "id2", "name": "executeAux4", "timestamp": 5 },
    { "role": "assistant_with_tool", "content": { "content": "", "tool_calls": [ { "id": "id3", "name": "executeAux4", "args": { "command": "kb update r2-3 --content reviewed" }, "type": "tool_call" } ] }, "timestamp": 6 }
  ],
  "tokenUsage": {}
}
```

```file:diff3-tr.json
[
  { "id": "id3", "content": "Error executing tool \"executeAux4\": Content is required (use --content or --file)" }
]
```

```execute
if [ -z "$AUX4_TEST_MLX" ]; then echo 'guidance present: false'; else aux4 ai agent resume --configFile loop-config.yaml --config agent --instructions AGENTS.md --history diff3.json --tools executeAux4 --toolResults diff3-tr.json >/dev/null 2>&1; node -e 'const h=require("./diff3.json");const t=h.messages.filter(m=>m.role==="tool");const l=t[t.length-1];console.log("guidance present: "+l.content.includes("[agent:repeated-failure]"));'; fi
```

```expect:partial
guidance present: false
```

## a call that finally succeeds is not flagged

### should NOT append guidance when the third result differs (success)

```timeout
120000
```

```file:succ3.json
{
  "messages": [
    { "role": "user", "content": "mark it reviewed", "timestamp": 1 },
    { "role": "assistant_with_tool", "content": { "content": "", "tool_calls": [ { "id": "id1", "name": "executeAux4", "args": { "command": "kb update r2-3" }, "type": "tool_call" } ] }, "timestamp": 2 },
    { "role": "tool", "content": "Error executing tool \"executeAux4\": Content is required (use --content or --file)", "tool_call_id": "id1", "name": "executeAux4", "timestamp": 3 },
    { "role": "assistant_with_tool", "content": { "content": "", "tool_calls": [ { "id": "id2", "name": "executeAux4", "args": { "command": "kb update r2-3" }, "type": "tool_call" } ] }, "timestamp": 4 },
    { "role": "tool", "content": "Error executing tool \"executeAux4\": Content is required (use --content or --file)", "tool_call_id": "id2", "name": "executeAux4", "timestamp": 5 },
    { "role": "assistant_with_tool", "content": { "content": "", "tool_calls": [ { "id": "id3", "name": "executeAux4", "args": { "command": "kb update r2-3" }, "type": "tool_call" } ] }, "timestamp": 6 }
  ],
  "tokenUsage": {}
}
```

```file:succ3-tr.json
[
  { "id": "id3", "content": "Updated r2-3 successfully" }
]
```

```execute
if [ -z "$AUX4_TEST_MLX" ]; then echo 'guidance present: false'; else aux4 ai agent resume --configFile loop-config.yaml --config agent --instructions AGENTS.md --history succ3.json --tools executeAux4 --toolResults succ3-tr.json >/dev/null 2>&1; node -e 'const h=require("./succ3.json");const t=h.messages.filter(m=>m.role==="tool");const l=t[t.length-1];console.log("guidance present: "+l.content.includes("[agent:repeated-failure]"));'; fi
```

```expect:partial
guidance present: false
```

```afterAll
rm -f loop3.json loop3-tr.json diff3.json diff3-tr.json succ3.json succ3-tr.json
```
