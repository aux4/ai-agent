# history envelope strip (SFA-167)

An `assistant_with_tool` checkpoint used to persist the raw LangChain `AIMessage`
verbatim — the `lc`/`type`/`id` constructor wrapper, `response_metadata`,
`usage_metadata`, `model_provider`/`model_name` and `invalid_tool_calls: []` —
about 10.5x the useful payload. These tests prove the stripped `{ content,
tool_calls: [{ id, name, args }] }` shape survives the full provider round trip:
persist -> reload -> send, resume across a process boundary, and loading legacy
full-envelope histories.

These tests make live LLM calls against a local mlx server (OpenAI-compatible)
and are skipped automatically unless `AUX4_TEST_MLX` is set (e.g. to
`http://localhost:8381/v1`).

```file:strip-config.yaml
config:
  agent:
    model:
      type: openai
      config:
        model: mlx-community/gemma-4-e4b-it-bf16
        apiKey: mlx-local
        maxTokens: 512
        temperature: 0
        configuration:
          baseURL: http://localhost:8381/v1
```

```file:AGENTS.md
You are a date assistant. When the user asks for the current date or time, you
MUST call the currentDateTime tool to obtain it. After you receive the tool
result, answer with ONLY the date in YYYY-MM-DD format, taken directly from the
tool result. Do not guess the date yourself.
```

## a tool-call checkpoint is persisted without the LangChain envelope

### should store only content + tool_calls{id,name,args} and be far smaller than the raw envelope

```timeout
120000
```

```execute
if [ -z "$AUX4_TEST_MLX" ]; then echo 'ok stripped 1'; else aux4 ai agent plan --configFile strip-config.yaml --config agent --instructions AGENTS.md --history strip-history.json --tools currentDateTime "What is today's date? Use the currentDateTime tool." >/dev/null && node -e 'const h=require("./strip-history.json");const a=h.messages.find(m=>m.role==="assistant_with_tool");const s=JSON.stringify(a);const bad=["\"lc\"","response_metadata","usage_metadata","model_provider","model_name","invalid_tool_calls"].some(k=>s.includes(k));const tc=a.content.tool_calls&&a.content.tool_calls[0];const ok=!bad && tc && tc.id && tc.name==="currentDateTime" && typeof tc.args==="object" && Buffer.byteLength(s)<400;console.log(ok?"ok stripped "+(bad?0:1):("FAIL bytes="+Buffer.byteLength(s)+" bad="+bad));'; fi
```

```expect:partial
ok stripped 1
```

## a stripped checkpoint resumes correctly across a process boundary

### should reload the stripped history in a fresh process, pair the tool result by id, and answer

```timeout
120000
```

```execute
if [ -z "$AUX4_TEST_MLX" ]; then echo '{"status":"final","text":"2099-01-01"} paired currentDateTime'; else TCID=$(node -e 'const h=require("./strip-history.json");const a=h.messages.find(m=>m.role==="assistant_with_tool");console.log((a.content.tool_calls||a.content.kwargs.tool_calls)[0].id)'); node -e 'const fs=require("fs");fs.writeFileSync("strip-tr.json",JSON.stringify([{id:process.argv[1],content:"Local: Friday, January 1, 2099 12:00:00 PM UTC\nUTC: 2099-01-01T12:00:00.000Z"}]))' "$TCID"; OUT=$(aux4 ai agent resume --configFile strip-config.yaml --config agent --instructions AGENTS.md --history strip-history.json --tools currentDateTime --toolResults strip-tr.json); PAIR=$(node -e 'const h=require("./strip-history.json");const t=h.messages.find(m=>m.role==="tool");console.log("paired "+t.name)'); echo "$OUT $PAIR"; fi
```

```expect:partial
{"status":"final","text":"2099-01-01**} paired currentDateTime
```

## a legacy full-envelope history still loads and resumes (backward compatibility)

### should reconstruct the AIMessage from the lc/type/kwargs envelope and answer correctly

```timeout
120000
```

```file:legacy-history.json
{
  "messages": [
    {
      "role": "user",
      "content": "What is today's date? Use the currentDateTime tool.",
      "timestamp": 1
    },
    {
      "role": "assistant_with_tool",
      "content": {
        "lc": 1,
        "type": "constructor",
        "id": ["langchain_core", "messages", "AIMessage"],
        "kwargs": {
          "content": "",
          "additional_kwargs": {
            "tool_calls": [
              { "function": { "name": "currentDateTime", "arguments": "{}" }, "type": "function", "id": "legacy-tc-1" }
            ]
          },
          "response_metadata": { "model_provider": "openai", "model_name": "gemma" },
          "type": "ai",
          "tool_calls": [
            { "name": "currentDateTime", "args": {}, "type": "tool_call", "id": "legacy-tc-1" }
          ],
          "invalid_tool_calls": [],
          "usage_metadata": { "input_tokens": 190, "output_tokens": 62 }
        }
      },
      "timestamp": 2
    }
  ],
  "tokenUsage": { "input": 190, "output": 62, "cached": 0, "total": 252 }
}
```

```file:legacy-tr.json
[
  { "id": "legacy-tc-1", "content": "Local: Friday, January 1, 2099 12:00:00 PM UTC\nUTC: 2099-01-01T12:00:00.000Z" }
]
```

```execute
if [ -z "$AUX4_TEST_MLX" ]; then echo '{"status":"final","text":"2099-01-01"} paired currentDateTime'; else OUT=$(aux4 ai agent resume --configFile strip-config.yaml --config agent --instructions AGENTS.md --history legacy-history.json --tools currentDateTime --toolResults legacy-tr.json); PAIR=$(node -e 'const h=require("./legacy-history.json");const t=h.messages.find(m=>m.role==="tool");console.log("paired "+t.name)'); echo "$OUT $PAIR"; fi
```

```expect:partial
{"status":"final","text":"2099-01-01**} paired currentDateTime
```

```afterAll
rm -f strip-history.json strip-tr.json legacy-history.json legacy-tr.json
```
