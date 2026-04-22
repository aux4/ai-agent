# ai agent remember

```file:remember-history.json
[
  {"role":"user","content":"What was the outcome of the Zylox-9 experiment?"},
  {"role":"assistant","content":"The Zylox-9 experiment produced compound FERRANOVA-331, which showed a 94% binding efficiency. Dr. Halbrook approved it for Phase 2 trials on March 3rd."},
  {"role":"user","content":"Who is leading the next phase?"},
  {"role":"assistant","content":"Dr. Mendelev is leading Phase 2. The trial site is at the Kirkwall Research Center in sector 7B."}
]
```

```afterAll
rm -f remember-history.json
```

## missing model

### should fail without model configuration

```execute
aux4 ai agent remember remember-history.json
```

```error:partial
Error: Model configuration is required*
```

## file not found

### should fail when history file does not exist

```execute
aux4 ai agent remember nonexistent.json --model '{"type":"openai","config":{"model":"gpt-4o-mini"}}'
```

```error:partial
Error: History file*not found
```

## remember with model

### should generate a memory entry from history

```timeout
120000
```

```execute
aux4 ai agent remember remember-history.json --config
```

```expect:partial:ignoreCase
*FERRANOVA-331*
```
