# ai agent use

## ask with --use

### should answer using the named model

```timeout
60000
```

```execute
aux4 ai agent ask --models '{"fast":{"type":"openai","config":{"model":"gpt-4o-mini"}}}' --useModel fast --question "What is 2+2? Reply with just the number."
```

```expect:partial
4
```

## ask with unknown --use

### should fail with unknown model name

```execute
aux4 ai agent ask --models '{"fast":{"type":"openai","config":{"model":"gpt-4o-mini"}}}' --useModel nonexistent --question "hello"
```

```error:partial
Unknown model "nonexistent"*
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
  {"role":"user","content":"What is the capital of France?"},
  {"role":"assistant","content":"The capital of France is Paris."}
]
```

```afterAll
rm -f use-remember-history.json
```

### should generate memory using named model

```timeout
60000
```

```execute
aux4 ai agent remember use-remember-history.json --models '{"fast":{"type":"openai","config":{"model":"gpt-4o-mini"}}}' --useModel fast
```

```expect:partial:ignoreCase
*Paris*
```

## summarize with --use

```file:use-summarize-history.json
[
  {"role":"user","content":"What is the capital of France?"},
  {"role":"assistant","content":"The capital of France is Paris."}
]
```

```afterAll
rm -f use-summarize-history.json
```

### should summarize using named model

```timeout
60000
```

```execute
aux4 ai agent summarize use-summarize-history.json --models '{"fast":{"type":"openai","config":{"model":"gpt-4o-mini"}}}' --useModel fast
```

```expect:partial:ignoreCase
*Paris*
```
