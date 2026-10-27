# executeAux4 runs aux4 without a shell

These tests drive the agent against a deterministic mock OpenAI-compatible server
(`support/mock-openai-server.mjs`) instead of a real model, so the exact
executeAux4 tool call is controlled by the test, not by model behavior. A fake `aux4`
binary (`support/aux4`) is put ahead of the real one on `PATH`; it just prints its argv,
proving exactly what `spawn()` received — with no shell in between, a bare `$` or an
unquoted `&` inside an argument must arrive unchanged. The real `aux4` (resolved before
`PATH` is changed) runs `ai agent ask` itself, so only the tool's own spawned child sees
the fake one.

```beforeAll
nohup node support/mock-openai-server.mjs 58291 >mock-server.log 2>&1 &
sleep 1
```

```afterAll
pkill -f "mock-openai-server.mjs 58291" || true
rm -f history.json mock-server.log
```

```beforeEach
rm -f history.json
```

## a bare $ inside a double-quoted argument is not expanded

### should reach the command exactly as written, including the $9.99 amount

```timeout
30000
```

```execute
AUX4_BIN="$(command -v aux4)"; PATH="$PWD/support:$PATH" "$AUX4_BIN" ai agent ask --model '{"type":"openai","config":{"model":"gpt-test","apiKey":"sk-test","configuration":{"baseURL":"http://127.0.0.1:58291/v1"}}}' --history history.json 'RUN:x --q "price $9.99"'
```

```expect:partial
"price $9.99"
```

## an unquoted & inside a word (URL query string) passes through as one argument

### should keep the whole URL as a single argv entry

```timeout
30000
```

```execute
AUX4_BIN="$(command -v aux4)"; PATH="$PWD/support:$PATH" "$AUX4_BIN" ai agent ask --model '{"type":"openai","config":{"model":"gpt-test","apiKey":"sk-test","configuration":{"baseURL":"http://127.0.0.1:58291/v1"}}}' --history history.json 'RUN:x --url http://h/p?a=1&b=2'
```

```expect:partial
"http://h/p?a=1&b=2"
```

## an unquoted chained command is rejected, not run

### should refuse a bare ; instead of running two commands

```timeout
30000
```

```execute
AUX4_BIN="$(command -v aux4)"; PATH="$PWD/support:$PATH" "$AUX4_BIN" ai agent ask --model '{"type":"openai","config":{"model":"gpt-test","apiKey":"sk-test","configuration":{"baseURL":"http://127.0.0.1:58291/v1"}}}' --history history.json 'RUN:version ; rm -rf /tmp/should-not-run'
```

```expect:partial
Invalid command:
```

## a quoted chain-looking character is just a literal argument

### should allow a quoted semicolon through as plain text

```timeout
30000
```

```execute
AUX4_BIN="$(command -v aux4)"; PATH="$PWD/support:$PATH" "$AUX4_BIN" ai agent ask --model '{"type":"openai","config":{"model":"gpt-test","apiKey":"sk-test","configuration":{"baseURL":"http://127.0.0.1:58291/v1"}}}' --history history.json 'RUN:x ";"'
```

```expect:partial
["x",";"]
```

## an unterminated quote is rejected with a clear error

### should not run anything and report the bad quoting

```timeout
30000
```

```execute
AUX4_BIN="$(command -v aux4)"; PATH="$PWD/support:$PATH" "$AUX4_BIN" ai agent ask --model '{"type":"openai","config":{"model":"gpt-test","apiKey":"sk-test","configuration":{"baseURL":"http://127.0.0.1:58291/v1"}}}' --history history.json 'RUN:x "unterminated'
```

```expect:partial
Invalid command:
```
