# mcp

Makes a live LLM call (with an MCP tool). Skipped when no LLM credentials are
present (CI); runs for real when `OPENAI_API_KEY` (or `AUX4_TEST_LLM`) is set.

```timeout
90000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "LLM-SKIPPED"; else aux4 ai agent ask "what time is it now in UTC? Please respond with just the time in HH:MM format." --config; fi
```

```expect:regex
^(\d{2}:\d{2}|LLM-SKIPPED)$
```
