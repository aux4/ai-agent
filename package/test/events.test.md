# structured JSON event stream

These tests are deterministic and need **no LLM credentials**. They point the OpenAI
provider at a local mock server (a dummy API key + a `configuration.baseURL` on
`127.0.0.1`) so the whole agent tool-loop runs without any real API call.

The `--events <sink>` flag turns on a structured JSONL event stream for a supervising
process. It is **default OFF** (empty value = no events, zero overhead). Each event is
one JSON object per line carrying `ts`, a monotonic `seq` (from 0), a per-run `run` id,
a `type`, and type-specific fields.

The mock's reply is driven by sentinels in the prompt / conversation:

- `STOPNOW` — answer immediately (no tools).
- `LOOPFOREVER` — always request the `currentDateTime` tool (an infinite loop that only
  the loop budget can stop).
- `ASKME` — request the `askUser` tool (parks with no TTY + a history file).
- otherwise — request `currentDateTime` once, then answer once the tool result is seen
  (a normal one-tool run).

```file:mock-openai-server.mjs
import http from "node:http";

const port = parseInt(process.argv[2] || "8741", 10);

http.createServer((req, res) => {
  let body = "";
  req.on("data", chunk => (body += chunk));
  req.on("end", () => {
    const has = s => body.includes(s);
    const hasToolResult = /"role"\s*:\s*"tool"/.test(body);

    let message;
    if (has("STOPNOW")) {
      message = { role: "assistant", content: "Done: the mock answer is 42." };
    } else if (has("ASKME")) {
      message = {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_ask",
            type: "function",
            function: { name: "askUser", arguments: JSON.stringify({ question: "What is your favorite color?" }) }
          }
        ]
      };
    } else if (has("LOOPFOREVER")) {
      message = {
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
    } else if (hasToolResult) {
      message = { role: "assistant", content: "Done: the mock answer is 42." };
    } else {
      message = {
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
    }

    const payload = {
      id: "chatcmpl-mock",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "gpt-4o-mini",
      choices: [{ index: 0, message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }],
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
      "baseURL": "http://127.0.0.1:8741/v1"
    }
  }
}
```

```file:check-events.mjs
import fs from "node:fs";

const file = process.argv[2];
const lines = fs.readFileSync(file, "utf8").split("\n").filter(l => l.trim() !== "");

let allValidJson = true;
let events = [];
for (const line of lines) {
  try {
    events.push(JSON.parse(line));
  } catch {
    allValidJson = false;
  }
}

let mono = events.length > 0;
for (let i = 0; i < events.length; i++) {
  if (events[i].seq !== i) mono = false;
}

const run = events.length > 0 ? events[0].run : null;
const sameRun = events.every(e => e.run === run && !!run);
const hasTs = events.every(e => typeof e.ts === "number");
const types = new Set(events.map(e => e.type));

console.log("validJson:" + allValidJson);
console.log("mono:" + mono);
console.log("sameRun:" + sameRun);
console.log("hasTs:" + hasTs);
console.log("first:" + (events[0] && events[0].type));
console.log("last:" + (events[events.length - 1] && events[events.length - 1].type));
console.log("status:" + (events[events.length - 1] && events[events.length - 1].status));

const required = process.argv.slice(3);
console.log("required:" + required.every(t => types.has(t)));
```

## event stream

```afterAll
pkill -f "mock-openai-server.mjs" || true
rm -f ev-normal.jsonl ev-budget.jsonl ev-park.jsonl ev-off.stderr ev-hist.json park-hist.json off-hist.json
```

### should start the mock model server

```execute
nohup node mock-openai-server.mjs 8741 >/dev/null 2>&1 &
sleep 1
curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:8741/v1/chat/completions -d '{}'
```

```expect
200
```

### should emit an ordered well-formed JSONL sequence for a normal run

```execute
rm -f ev-normal.jsonl ev-hist.json
aux4 ai agent ask --model "$(cat model.json)" --history ev-hist.json --events ev-normal.jsonl "please use your tool" >/dev/null 2>&1
node check-events.mjs ev-normal.jsonl run.start iteration.start model.request model.response tool.start tool.end run.end
```

```expect
validJson:true
mono:true
sameRun:true
hasTs:true
first:run.start
last:run.end
status:ok
required:true
```

### should record the budget-exceeded status for a runaway loop

```execute
rm -f ev-budget.jsonl
aux4 ai agent ask --model "$(cat model.json)" --events ev-budget.jsonl --maxIterations 2 "LOOPFOREVER" >/dev/null 2>&1
node check-events.mjs ev-budget.jsonl run.start budget.exceeded run.end
```

```expect
validJson:true
mono:true
sameRun:true
hasTs:true
first:run.start
last:run.end
status:budget-exceeded
required:true
```

### should record the parked status when a question is parked with no TTY

```execute
rm -f ev-park.jsonl park-hist.json
aux4 ai agent ask --model "$(cat model.json)" --history park-hist.json --events ev-park.jsonl "ASKME" >/dev/null 2>&1
node check-events.mjs ev-park.jsonl run.start question.parked run.end
```

```expect
validJson:true
mono:true
sameRun:true
hasTs:true
first:run.start
last:run.end
status:parked
required:true
```

### should exit with the pending exit code on a parked run

```execute
rm -f ev-park.jsonl park-hist.json
aux4 ai agent ask --model "$(cat model.json)" --history park-hist.json --events ev-park.jsonl "ASKME" >/dev/null 2>&1; echo "exit:$?"
```

```expect
exit:10
```

### should emit nothing when the events flag is off

```execute
rm -f off-hist.json ev-off.stderr
aux4 ai agent ask --model "$(cat model.json)" --history off-hist.json "please use your tool" >ev-off.stderr 2>&1
grep -c '"type":"run.' ev-off.stderr || true
```

```expect
0
```

### should not create any events file when the flag is off

```execute
rm -f off-hist.json should-not-exist.jsonl
aux4 ai agent ask --model "$(cat model.json)" --history off-hist.json "please use your tool" >/dev/null 2>&1
test -f should-not-exist.jsonl && echo "EXISTS" || echo "ABSENT"
```

```expect
ABSENT
```
```
