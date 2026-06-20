# codex

Makes a live LLM call through the Codex API (uses local Codex credentials, not
`OPENAI_API_KEY`). Skipped unless `AUX4_TEST_LLM` is set, so it never runs in CI.

## simple question

```timeout
120000
```

```execute
if [ -z "$AUX4_TEST_LLM" ]; then echo "LLM-SKIPPED"; else aux4 ai agent ask --model '{"api":"codex","config":{"model":"gpt-5.3-codex"}}' --question "What is 2+2? Reply with just the number."; fi
```

```expect:regex
(^|[^0-9])4([^0-9]|$)|LLM-SKIPPED
```
