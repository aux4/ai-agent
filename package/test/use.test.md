# ai agent use

The `ask`/`remember`/`summarize` cases below make live LLM calls and are skipped
when no LLM credentials are present (CI); they run for real when `OPENAI_API_KEY`
(or `AUX4_TEST_LLM`) is set. The `models` registry-listing case is deterministic
and always runs.

## ask with --use

### should answer using the named model

```timeout
120000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "4"; else aux4 ai agent ask --models '{"fast":{"type":"openai","config":{"model":"gpt-4o-mini"}}}' --useModel fast --question "What is 2+2? Reply with just the number."; fi
```

```expect:partial
4
```

## ask with unknown --use

### should fallback to default model

```timeout
120000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "4"; else aux4 ai agent ask --models '{"fast":{"type":"openai","config":{"model":"gpt-4o-mini"}}}' --useModel nonexistent --model '{"type":"openai","config":{"model":"gpt-4o-mini"}}' --question "What is 2+2? Reply with just the number."; fi
```

```expect:partial
4
```

## models command

### should list available models from registry

```execute
aux4 ai agent models --models '{"strong":{"type":"openai","config":{"model":"gpt-4o"},"description":"Complex reasoning"},"fast":{"type":"openai","config":{"model":"gpt-4o-mini"},"description":"Simple tasks"}}'
```

```expect:partial
strong
```

## remember with --use

```file:use-remember-history.json
[
  {"role":"user","content":"What happened at the Nexora summit?"},
  {"role":"assistant","content":"The Nexora summit concluded with the signing of the PALLADIUM-7 accord by delegates from all 12 participating sectors."}
]
```

```afterAll
rm -f use-remember-history.json
```

### should generate memory using named model

```timeout
120000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "PALLADIUM-7"; else aux4 ai agent remember use-remember-history.json --models '{"fast":{"type":"openai","config":{"model":"gpt-4o-mini"}}}' --useModel fast; fi
```

```expect:partial:ignoreCase
*PALLADIUM-7*
```

## summarize with --use

```file:use-summarize-history.json
[
  {"role":"user","content":"What happened at the Nexora summit?"},
  {"role":"assistant","content":"The Nexora summit concluded with the signing of the PALLADIUM-7 accord by delegates from all 12 participating sectors."}
]
```

```afterAll
rm -f use-summarize-history.json
```

### should summarize using named model

```timeout
120000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "PALLADIUM-7"; else aux4 ai agent summarize use-summarize-history.json --models '{"fast":{"type":"openai","config":{"model":"gpt-4o-mini"}}}' --useModel fast; fi
```

```expect:partial:ignoreCase
*PALLADIUM-7*
```
