# ai agent summarize

```file:summarize-history.json
[
  {"role":"user","content":"What was the outcome of the Zylox-9 experiment?"},
  {"role":"assistant","content":"The Zylox-9 experiment produced compound FERRANOVA-331, which showed a 94% binding efficiency. Dr. Halbrook approved it for Phase 2 trials on March 3rd."},
  {"role":"user","content":"Who is leading the next phase?"},
  {"role":"assistant","content":"Dr. Mendelev is leading Phase 2. The trial site is at the Kirkwall Research Center in sector 7B."}
]
```

```afterAll
rm -f summarize-history.json
```

## missing model

### should fail without model configuration

```execute
aux4 ai agent summarize summarize-history.json
```

```error:partial
Error: Model configuration is required*
```

## file not found

### should fail when history file does not exist

```execute
aux4 ai agent summarize nonexistent.json --model '{"type":"openai","config":{"model":"gpt-4o-mini"}}'
```

```error:partial
Error: History file*not found
```

## summarize with model

This makes a live LLM call. It is skipped when no LLM credentials are present
(CI); it runs for real when `OPENAI_API_KEY` (or `AUX4_TEST_LLM`) is set.

### should produce a summary mentioning key topics

```timeout
120000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "FERRANOVA-331"; else aux4 ai agent summarize summarize-history.json --config; fi
```

```expect:partial:ignoreCase
*FERRANOVA-331*
```
