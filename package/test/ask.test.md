# ask simple questions

These tests make live LLM calls. They are skipped automatically when no LLM
credentials are present (e.g. in CI), and run for real when `OPENAI_API_KEY`
(or `AUX4_TEST_LLM`) is set.

```timeout
120000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "LLM-SKIPPED"; else aux4 ai agent ask --config --question "What's the capital of France? Just output the name of the city, nothing else."; fi
```

```expect:regex
(Paris|LLM-SKIPPED)
```

## anthropic system-message ordering (regression, keyless)

Regression for the Anthropic system-message ordering bug. Base instructions plus
`--instructions` produce two system messages, and the output schema adds another;
Anthropic rejects any system message that is not the single first message. The fix
collapses every system message into one leading system message.

This test is deterministic and needs no LLM credentials: it uses a dummy API key
and points the model at a dead loopback endpoint. When assembly is valid the call
reaches the (unreachable) endpoint and fails with a connection error. If the
ordering bug regresses, assembly fails earlier — client-side — with
`System messages are only permitted as the first passed message.` instead, and the
expectation below no longer matches.

```file:anthropic-order-config.yaml
config:
  model:
    type: anthropic
    config:
      model: claude-sonnet-4-5-20250929
      anthropicApiUrl: http://127.0.0.1:1
      maxRetries: 0
  permissions:
    allow:
      - "*"
    ask: []
    deny: []
```

```file:anthropic-order-instructions.md
You are a grammar assistant. Fix grammar only.
```

### should collapse system messages into one leading system message

```execute
ANTHROPIC_API_KEY=sk-ant-dummy aux4 ai agent ask --configFile anthropic-order-config.yaml --config --instructions anthropic-order-instructions.md "he go to school" 2>&1 | grep -iE "system messages are only permitted|connection error" | head -1
```

```expect:partial
Connection error.
```
