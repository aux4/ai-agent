# history session locking

These tests are deterministic and need **no LLM credentials**. Like the loop-budget
tests, they point the OpenAI provider at a local mock server (dummy API key +
`configuration.baseURL` on `127.0.0.1`). The mock returns a normal answer when the
prompt contains `STOPNOW`, and otherwise asks the model to call `currentDateTime`
forever (with a small per-round delay) so a run holds the history lock long enough
for a second run to contend with it.

Every `ask`/`chat`/`compact` on a `--history` file now acquires a real advisory lock
(`<history>.lock`, pid + timestamp, created atomically). The lock is held for the
whole run, refreshed on every save, and released on all exit paths. On contention the
default is to fail fast with a clear error and exit code `8`; `--waitLock <duration>`
opts into poll-waiting. A lock whose owner is dead (same-host pid gone) or that has
not been refreshed within the stale threshold (`--staleLock`, default 30m) is stolen
with a warning. History files are written atomically (temp file + rename), so a reader
or a crashing writer never sees a half-written file — this replaces the old 1.5x size
heuristic.

```file:mock-openai-server.mjs
import http from "node:http";

const port = parseInt(process.argv[2] || "8738", 10);

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

    // Delay the loop rounds so a running ask holds the lock long enough for a
    // second ask to contend; answer immediately on the STOPNOW path.
    setTimeout(() => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    }, stop ? 0 : 250);
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
      "baseURL": "http://127.0.0.1:8738/v1"
    }
  }
}
```

## locking behavior

```afterAll
pkill -f "mock-openai-server.mjs" || true
rm -f *.json.lock *.json.*.tmp lock-*.json
```

### should start the mock model server

```execute
nohup node mock-openai-server.mjs 8738 >/dev/null 2>&1 &
sleep 1
curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:8738/v1/chat/completions -d '{}'
```

```expect
200
```

### should acquire and release the lock over a clean run

```execute
rm -f lock-clean.json lock-clean.json.lock
aux4 ai agent ask --model "$(cat model.json)" --history lock-clean.json "just answer STOPNOW" 2>/dev/null
echo "lock_exists:$([ -f lock-clean.json.lock ] && echo yes || echo no)"
```

```expect
Done: the mock answer is 42.
lock_exists:no
```

### should write the history atomically as valid json with no temp leftovers

```execute
rm -f lock-atomic.json lock-atomic.json.lock lock-atomic.json.*.tmp
aux4 ai agent ask --model "$(cat model.json)" --history lock-atomic.json "just answer STOPNOW" >/dev/null 2>&1
node -e 'const h=require("./lock-atomic.json");console.log("messages:"+Array.isArray(h.messages));console.log("nonempty:"+(h.messages.length>0))'
echo "tmp_leftovers:$(ls lock-atomic.json.*.tmp 2>/dev/null | wc -l | tr -d " ")"
```

```expect
messages:true
nonempty:true
tmp_leftovers:0
```

### should fail fast with the lock exit code when the history is held

```execute
rm -f lock-ff.json.lock
printf '{"pid":424242,"host":"otherhost","time":%s,"iso":"2026-07-06T00:00:00Z"}' "$(node -e 'console.log(Date.now())')" > lock-ff.json.lock
aux4 ai agent ask --model "$(cat model.json)" --history lock-ff.json "hi" >/dev/null 2>&1; echo "exit:$?"
rm -f lock-ff.json.lock
```

```expect
exit:8
```

### should report the current holder on contention

```execute
rm -f lock-msg.json.lock
printf '{"pid":424242,"host":"otherhost","time":%s,"iso":"2026-07-06T00:00:00Z"}' "$(node -e 'console.log(Date.now())')" > lock-msg.json.lock
aux4 ai agent ask --model "$(cat model.json)" --history lock-msg.json "hi" 2>&1 | grep -o "history in use by pid 424242 on otherhost" | head -1
rm -f lock-msg.json.lock
```

```expect
history in use by pid 424242 on otherhost
```

### should poll-wait with --waitLock and still fail when the lock never frees

```execute
rm -f lock-wait.json.lock
printf '{"pid":424242,"host":"otherhost","time":%s,"iso":"2026-07-06T00:00:00Z"}' "$(node -e 'console.log(Date.now())')" > lock-wait.json.lock
aux4 ai agent ask --model "$(cat model.json)" --history lock-wait.json --waitLock 600ms "hi" 2>&1 | grep -o "waiting up to 600ms" | head -1
rm -f lock-wait.json.lock
```

```expect
waiting up to 600ms
```

### should steal a lock whose same-host owner is dead

```execute
rm -f lock-dead.json lock-dead.json.lock
sleep 0.1 & DEADPID=$!; wait $DEADPID
printf '{"pid":%s,"host":"%s","time":%s}' "$DEADPID" "$(hostname)" "$(node -e 'console.log(Date.now())')" > lock-dead.json.lock
aux4 ai agent ask --model "$(cat model.json)" --history lock-dead.json "just answer STOPNOW" 2>&1 | grep -o "stealing stale history lock" | head -1
```

```expect
stealing stale history lock
```

### should steal a lock that has gone stale by age

```execute
rm -f lock-age.json lock-age.json.lock
sleep 30 & LIVEPID=$!
printf '{"pid":%s,"host":"%s","time":%s}' "$LIVEPID" "$(hostname)" "$(node -e 'console.log(Date.now()-600000)')" > lock-age.json.lock
aux4 ai agent ask --model "$(cat model.json)" --history lock-age.json --staleLock 1s "just answer STOPNOW" 2>&1 | grep -o "stealing stale history lock" | head -1
kill $LIVEPID 2>/dev/null || true
```

```expect
stealing stale history lock
```

### should let a fresh run proceed after stealing a stale lock

```execute
rm -f lock-steal-run.json lock-steal-run.json.lock
sleep 0.1 & DEADPID=$!; wait $DEADPID
printf '{"pid":%s,"host":"%s","time":%s}' "$DEADPID" "$(hostname)" "$(node -e 'console.log(Date.now())')" > lock-steal-run.json.lock
aux4 ai agent ask --model "$(cat model.json)" --history lock-steal-run.json "just answer STOPNOW" 2>/dev/null
```

```expect
Done: the mock answer is 42.
```

### should fail a concurrent ask fast and keep the history uncorrupted

```execute
rm -f lock-conc.json lock-conc.json.lock
nohup aux4 ai agent ask --model "$(cat model.json)" --history lock-conc.json --maxIterations 12 "loop forever" >/dev/null 2>&1 &
for i in $(seq 1 60); do [ -f lock-conc.json.lock ] && break; sleep 0.1; done
aux4 ai agent ask --model "$(cat model.json)" --history lock-conc.json "second run" >/dev/null 2>&1; echo "second_exit:$?"
wait
node -e 'const h=require("./lock-conc.json");console.log("valid:"+Array.isArray(h.messages))'
```

```expect
second_exit:8
valid:true
```

### should acquire the lock for the compact command

```execute
rm -f lock-compact.json.lock
printf '{"pid":424242,"host":"otherhost","time":%s,"iso":"2026-07-06T00:00:00Z"}' "$(node -e 'console.log(Date.now())')" > lock-compact.json.lock
printf '[{"role":"user","content":"hi"},{"role":"assistant","content":"hello"}]' > lock-compact.json
aux4 ai agent compact --model "$(cat model.json)" lock-compact.json >/dev/null 2>&1; echo "exit:$?"
rm -f lock-compact.json lock-compact.json.lock
```

```expect
exit:8
```
