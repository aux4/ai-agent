# Tool-call hooks (aux4 core hook standard)

`--hooks <file>` points `ask`/`chat` at a `{ "hooks": [...] }` file that follows aux4
core's own hook standard (command pattern matching, `params` filter, before/replace/
after/error phases). These tests drive the agent against a deterministic mock
OpenAI-compatible server (`support/mock-openai-server.mjs`), so the exact `executeAux4`
call is controlled by the test, not by model behavior — the server always answers
"RUN:\<command\>" with one `executeAux4` call for exactly that command, then echoes the
tool's result back as the final answer, so the printed output of `ask` IS the tool
result verbatim.

The command under test is a real, locally-discovered aux4 command (`probe`, declared
in this test's own `.aux4` fixture) rather than a mock binary: hooks resolve the
`<profile>/<command>` path the way aux4 itself does, via `aux4 probe --whereIsIt`, so
proving the hook fires against a real command is the point.

```file:.aux4
{
  "scope": "test",
  "name": "probe",
  "version": "0.0.1",
  "profiles": [
    {
      "name": "main",
      "commands": [
        {
          "name": "probe",
          "execute": [
            "log:probe-ran-for-real"
          ],
          "help": {
            "text": "probe",
            "variables": [
              {
                "name": "field",
                "text": "a repeatable field",
                "multiple": true,
                "default": ""
              }
            ]
          }
        }
      ]
    }
  ]
}
```

```beforeAll
nohup node support/mock-openai-server.mjs 58292 >mock-server.log 2>&1 &
sleep 1
```

```afterAll
pkill -f "mock-openai-server.mjs 58292" || true
rm -f history.json mock-server.log
```

```beforeEach
rm -f history.json
```

## a before hook matching the exact command path blocks the call

```file:hooks-exact.json
{
  "hooks": [
    {
      "command": "main/probe",
      "before": [
        "log:checking the request: ${__request}",
        "exit 1"
      ]
    }
  ]
}
```

### should never run the real command and name the hook's own message

```timeout
30000
```

```execute
aux4 ai agent ask --model '{"type":"openai","config":{"model":"gpt-test","apiKey":"sk-test","configuration":{"baseURL":"http://127.0.0.1:58292/v1"}}}' --history history.json --hooks hooks-exact.json 'RUN:probe'
```

```expect:partial
Blocked by hook:
```

```expect:partial
checking the request:
```

## a `*` wildcard on the command segment also matches

```file:hooks-wildcard.json
{
  "hooks": [
    {
      "command": "*/probe",
      "before": [
        "exit 1"
      ]
    }
  ]
}
```

### should block the same way an exact pattern does

```timeout
30000
```

```execute
aux4 ai agent ask --model '{"type":"openai","config":{"model":"gpt-test","apiKey":"sk-test","configuration":{"baseURL":"http://127.0.0.1:58292/v1"}}}' --history history.json --hooks hooks-wildcard.json 'RUN:probe'
```

```expect:partial
Blocked by hook:
```

## a params filter that the call does not satisfy never matches

```file:hooks-params-miss.json
{
  "hooks": [
    {
      "command": "main/probe",
      "params": {
        "field": "confirm=yes"
      },
      "before": [
        "exit 1"
      ]
    }
  ]
}
```

### should run the real command when the required field value is absent

```timeout
30000
```

```execute
aux4 ai agent ask --model '{"type":"openai","config":{"model":"gpt-test","apiKey":"sk-test","configuration":{"baseURL":"http://127.0.0.1:58292/v1"}}}' --history history.json --hooks hooks-params-miss.json 'RUN:probe'
```

```expect
probe-ran-for-real
```

## a repeatable --field matches a params filter if ANY of its values match

```file:hooks-params-repeat.json
{
  "hooks": [
    {
      "command": "main/probe",
      "params": {
        "field": "confirm=yes"
      },
      "before": [
        "exit 1"
      ]
    }
  ]
}
```

### should block when one of several repeated values matches

```timeout
30000
```

```execute
aux4 ai agent ask --model '{"type":"openai","config":{"model":"gpt-test","apiKey":"sk-test","configuration":{"baseURL":"http://127.0.0.1:58292/v1"}}}' --history history.json --hooks hooks-params-repeat.json 'RUN:probe --field id=12345 --field confirm=yes'
```

```expect:partial
Blocked by hook:
```

## a `|` alternative in a params filter matches any listed value

```file:hooks-params-alt.json
{
  "hooks": [
    {
      "command": "main/probe",
      "params": {
        "field": "confirm=yes|confirm=y"
      },
      "before": [
        "exit 1"
      ]
    }
  ]
}
```

### should block on either alternative

```timeout
30000
```

```execute
aux4 ai agent ask --model '{"type":"openai","config":{"model":"gpt-test","apiKey":"sk-test","configuration":{"baseURL":"http://127.0.0.1:58292/v1"}}}' --history history.json --hooks hooks-params-alt.json 'RUN:probe --field confirm=y'
```

```expect:partial
Blocked by hook:
```

## a `replace` hook stands in for the call

```file:hooks-replace.json
{
  "hooks": [
    {
      "command": "main/probe",
      "replace": [
        "log:stubbed result, real command never ran"
      ]
    }
  ]
}
```

### should return the hook's own output instead of running the command

```timeout
30000
```

```execute
aux4 ai agent ask --model '{"type":"openai","config":{"model":"gpt-test","apiKey":"sk-test","configuration":{"baseURL":"http://127.0.0.1:58292/v1"}}}' --history history.json --hooks hooks-replace.json 'RUN:probe'
```

```expect
stubbed result, real command never ran
```

## an `after` hook can decorate a successful result

```file:hooks-after.json
{
  "hooks": [
    {
      "command": "main/probe",
      "after": [
        "log:decorated: ${__response}"
      ]
    }
  ]
}
```

### should run the real command and then substitute the after hook's own output

```timeout
30000
```

```execute
aux4 ai agent ask --model '{"type":"openai","config":{"model":"gpt-test","apiKey":"sk-test","configuration":{"baseURL":"http://127.0.0.1:58292/v1"}}}' --history history.json --hooks hooks-after.json 'RUN:probe'
```

```expect:partial
decorated: probe-ran-for-real
```

## order runs lower Order first

```file:hooks-order.json
{
  "hooks": [
    {
      "command": "main/probe",
      "order": 10,
      "before": [
        "exit 1"
      ]
    },
    {
      "command": "main/probe",
      "order": 1,
      "before": [
        "log:first-by-order",
        "exit 1"
      ]
    }
  ]
}
```

### should run the lower-order hook's before step first and block on it

```timeout
30000
```

```execute
aux4 ai agent ask --model '{"type":"openai","config":{"model":"gpt-test","apiKey":"sk-test","configuration":{"baseURL":"http://127.0.0.1:58292/v1"}}}' --history history.json --hooks hooks-order.json 'RUN:probe'
```

```expect:partial
first-by-order
```

## no --hooks flag means no hook behavior at all

### should run the real command unaffected

```timeout
30000
```

```execute
aux4 ai agent ask --model '{"type":"openai","config":{"model":"gpt-test","apiKey":"sk-test","configuration":{"baseURL":"http://127.0.0.1:58292/v1"}}}' --history history.json 'RUN:probe'
```

```expect
probe-ran-for-real
```
