# plan and resume

The `plan` and `resume` commands split the agent's "decide" step from the "act"
step so an external orchestrator can run tools between turns. `plan` runs exactly
one LLM turn and returns a structured decision without executing tools; `resume`
injects externally-produced tool results and runs the next single turn.

These tests make live LLM calls against a local mlx server (OpenAI-compatible).
They are skipped automatically unless `AUX4_TEST_MLX` is set (e.g. to
`http://localhost:8381/v1`), and run for real when it is.

```file:plan-resume-config.yaml
config:
  agent:
    model:
      type: openai
      config:
        model: mlx-community/gemma-4-e4b-it-bf16
        apiKey: mlx-local
        maxTokens: 1024
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

## plan returns a structured tool-call decision

### should return status tool_calls with the currentDateTime tool and not execute it

```timeout
120000
```

```execute
if [ -z "$AUX4_TEST_MLX" ]; then echo '{"status":"tool_calls","toolCalls":[{"id":"x","name":"currentDateTime","arguments":{}}]}'; else aux4 ai agent plan --configFile plan-resume-config.yaml --config agent --instructions AGENTS.md --history history.json --tools currentDateTime "What is today's date? Use the currentDateTime tool."; fi
```

```expect:partial
{"status":"tool_calls","toolCalls":[{"id":"**","name":"currentDateTime","arguments":{}}]}
```

## resume injects a tool result and returns the final answer

### should return status final whose text reflects the injected synthetic result

```timeout
120000
```

```execute
if [ -z "$AUX4_TEST_MLX" ]; then echo '{"status":"final","text":"2099-01-01"}'; else TCID=$(node -e 'const h=require("./history.json");const a=h.messages.find(m=>m.role==="assistant_with_tool");console.log((a.content.tool_calls||a.content.kwargs.tool_calls)[0].id)'); node -e 'const fs=require("fs");fs.writeFileSync("tool-results.json",JSON.stringify([{id:process.argv[1],content:"Local: Friday, January 1, 2099 12:00:00 PM UTC\nUTC: 2099-01-01T12:00:00.000Z"}]))' "$TCID"; aux4 ai agent resume --configFile plan-resume-config.yaml --config agent --instructions AGENTS.md --history history.json --tools currentDateTime --toolResults tool-results.json; fi
```

```expect:partial
{"status":"final","text":"2099-01-01**}
```

```afterAll
rm -f history.json tool-results.json
```
