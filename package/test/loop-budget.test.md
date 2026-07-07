# loop budget

These tests are deterministic and need **no LLM credentials**. They point the
OpenAI provider at a local mock server (a dummy API key + a `configuration.baseURL`
on `127.0.0.1`) that always asks the model to call the `currentDateTime` tool. That
makes the agent tool-loop run forever, so the only thing that can stop it is the
loop budget. The mock returns a normal answer instead when the prompt contains the
token `STOPNOW`, which lets the same server exercise the non-budget path too.

The loop budget caps the agent tool-loop:

- `maxIterations` (always on, default 50) — hard cap on tool-execution rounds.
- `maxTokens` (optional) — cap on total tokens consumed during the ask.
- `maxTimeMs` (optional) — cap on wall-clock time spent in the loop.

When any limit trips, the loop stops cleanly: it appends a final assistant note
prefixed with `[budget-exceeded]`, persists the history and token usage, and the
`ask` command exits with code `7` so a supervisor can detect the truncation.

```file:mock-openai-server.mjs
import http from "node:http";

const port = parseInt(process.argv[2] || "8737", 10);

http.createServer((req, res) => {
  let body = "";
  req.on("data", chunk => (body += chunk));
  req.on("end", () => {
    let stop = false;
    try {
      stop = JSON.stringify(JSON.parse(body)).includes("STOPNOW");
    } catch {
      stop = false;
    }

    const message = stop
      ? { role: "assistant", content: "Done: the mock answer is 42." }
      : {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_" + Math.random().toString(36).slice(2, 8),
              type: "function",
              function: { name: "currentDateTime", arguments: "{}" }
            }
          ]
        };

    const payload = {
      id: "chatcmpl-mock",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "gpt-4o-mini",
      choices: [{ index: 0, message, finish_reason: stop ? "stop" : "tool_calls" }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  });
}).listen(port, "127.0.0.1", () => process.stderr.write(`mock-openai on ${port}\n`));
```

```file:model.json
{
  "type": "openai",
  "config": {
    "model": "gpt-4o-mini",
    "apiKey": "sk-test",
    "maxRetries": 0,
    "configuration": {
      "baseURL": "http://127.0.0.1:8737/v1"
    }
  }
}
```

## budget enforcement

```afterAll
pkill -f "mock-openai-server.mjs" || true
```

### should start the mock model server

```execute
nohup node mock-openai-server.mjs 8737 >/dev/null 2>&1 &
sleep 1
curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:8737/v1/chat/completions -d '{}'
```

```expect
200
```

### should stop a runaway tool loop at the iteration cap and mark the answer

```execute
aux4 ai agent ask --model "$(cat model.json)" --maxIterations 3 "loop forever" 2>/dev/null | grep -o "\[budget-exceeded\].*(limit 3)" | head -1
```

```expect
[budget-exceeded] Loop budget exceeded: maximum tool-loop iterations reached (limit 3)
```

### should exit with the distinguishable budget exit code

```execute
aux4 ai agent ask --model "$(cat model.json)" --maxIterations 3 "loop forever" >/dev/null 2>&1; echo "exit:$?"
```

```expect
exit:7
```

### should stop the loop when the token budget is reached

```execute
aux4 ai agent ask --model "$(cat model.json)" --maxIterations 50 --budget '{"maxTokens":150}' "loop forever" 2>/dev/null | grep -oiE "token budget reached" | head -1
```

```expect
token budget reached
```

### should stop the loop when the time budget is reached

```execute
aux4 ai agent ask --model "$(cat model.json)" --maxIterations 50 --budget '{"maxTimeMs":1}' "loop forever" 2>/dev/null | grep -oiE "time budget reached" | head -1
```

```expect
time budget reached
```

### should persist the budget-exceeded note and token usage to history

```execute
rm -f budget-history.json
aux4 ai agent ask --model "$(cat model.json)" --history budget-history.json --maxIterations 2 "loop forever" >/dev/null 2>&1
node -e 'const h=require("./budget-history.json");const last=h.messages[h.messages.length-1];console.log("role:"+last.role);console.log("marked:"+last.content.startsWith("[budget-exceeded]"));console.log("tokens:"+(h.tokenUsage.total>0))'
rm -f budget-history.json
```

```expect
role:assistant
marked:true
tokens:true
```

### should return the answer normally when the loop finishes within budget

```execute
aux4 ai agent ask --model "$(cat model.json)" --maxIterations 50 "just answer STOPNOW" 2>/dev/null
```

```expect
Done: the mock answer is 42.
```

### should not mark a normal answer with the budget marker

```execute
aux4 ai agent ask --model "$(cat model.json)" --maxIterations 50 "just answer STOPNOW" 2>/dev/null | grep -c "budget-exceeded" || true
```

```expect
0
```
