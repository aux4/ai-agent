# identical failing tool-call guard (HARN-029)

A dojo run called `aux4 google gmail get --id msg-ship-9f21` 59 times in one round, each time
hitting the identical error (a missing `--messageId`), because a tool error is just more text
the model can re-plan against unchanged. These tests drive the agent against a deterministic
mock OpenAI-compatible server (`support/mock-openai-loop-server.mjs`) that always re-issues the
same broken `executeAux4` call, plus a fake `aux4` binary (`support/loop-guard-bin/aux4`) that
fails the same way every time unless `--messageId` is added — so the real command, the model
turns, and the eventual fix are all controlled by the test, not by model behavior.

```beforeAll
rm -f loop-counter.txt
AUX4_BIN="$(command -v aux4)"
echo "$AUX4_BIN" > aux4-bin-path.txt
nohup node support/mock-openai-loop-server.mjs 58294 never >mock-loop-repeat.log 2>&1 &
nohup node support/mock-openai-loop-server.mjs 58295 2 >mock-loop-change.log 2>&1 &
sleep 1
```

```afterAll
pkill -f "mock-openai-loop-server.mjs 58294" || true
pkill -f "mock-openai-loop-server.mjs 58295" || true
rm -f history.json loop-counter.txt mock-loop-repeat.log mock-loop-change.log aux4-bin-path.txt
```

```beforeEach
rm -f history.json loop-counter.txt
```

## the model keeps repeating the identical broken call

### should run the broken call only twice, then refuse it quoting the error instead of running it again

```timeout
30000
```

```execute
AUX4_BIN="$(cat aux4-bin-path.txt)"; AUX4_LOOP_GUARD_COUNTER="$PWD/loop-counter.txt" PATH="$PWD/support/loop-guard-bin:$PATH" "$AUX4_BIN" ai agent ask --model '{"type":"openai","config":{"model":"gpt-test","apiKey":"sk-test","configuration":{"baseURL":"http://127.0.0.1:58294/v1"}}}' --history history.json 'go'
echo "real calls: $(wc -l < loop-counter.txt | tr -d ' ')"
```

```expect:partial
already made this exact call** Missing required parameter --messageId**real calls: 2
```

## a changed call (adding the missing flag) is never blocked

### should let the fixed call through on the third attempt and succeed

```timeout
30000
```

```execute
AUX4_BIN="$(cat aux4-bin-path.txt)"; AUX4_LOOP_GUARD_COUNTER="$PWD/loop-counter.txt" PATH="$PWD/support/loop-guard-bin:$PATH" "$AUX4_BIN" ai agent ask --model '{"type":"openai","config":{"model":"gpt-test","apiKey":"sk-test","configuration":{"baseURL":"http://127.0.0.1:58295/v1"}}}' --history history.json 'go'
echo "real calls: $(wc -l < loop-counter.txt | tr -d ' ')"
```

```expect:partial
Email retrieved: msg-ship-9f21**real calls: 3
```
