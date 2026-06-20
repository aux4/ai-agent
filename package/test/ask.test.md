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
