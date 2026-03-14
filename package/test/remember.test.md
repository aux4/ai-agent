# ai agent remember

```file:remember-history.json
[
  {"role":"user","content":"What is the capital of France?"},
  {"role":"assistant","content":"The capital of France is Paris."},
  {"role":"user","content":"What about Germany?"},
  {"role":"assistant","content":"The capital of Germany is Berlin."},
  {"role":"user","content":"And Italy?"},
  {"role":"assistant","content":"The capital of Italy is Rome."}
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
60000
```

```execute
aux4 ai agent remember remember-history.json --config
```

```expect:partial:ignoreCase
**capital*
```
