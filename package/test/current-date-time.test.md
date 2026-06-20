# current date time

Makes a live LLM call. Skipped when no LLM credentials are present (CI); runs
for real when `OPENAI_API_KEY` (or `AUX4_TEST_LLM`) is set.

```timeout
120000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "LLM-SKIPPED"; else aux4 ai agent ask --config --question "What is the current date? Use the currentDateTime tool. Just output the date in YYYY-MM-DD format, nothing else."; fi
```

```expect:regex
(\d{4}-\d{2}-\d{2}|LLM-SKIPPED)
```
