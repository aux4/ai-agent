# ask user tool

Makes a live LLM call. Skipped when no LLM credentials are present (CI); runs
for real when `OPENAI_API_KEY` (or `AUX4_TEST_LLM`) is set.

## should invoke askUser tool and return response

```timeout
120000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "LLM-SKIPPED"; else aux4 ai agent ask --config --question "Use the askUser tool to ask me what language I prefer. Just output the tool response, nothing else."; fi
```

```expect:regex:ignoreCase
(responded|non-interactive|proceed|judgment|llm-skipped)
```
