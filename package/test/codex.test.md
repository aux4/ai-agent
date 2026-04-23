# codex

## simple question

```timeout
120000
```

```execute
aux4 ai agent ask --model '{"api":"codex","config":{"model":"gpt-5.3-codex"}}' --question "What is 2+2? Reply with just the number."
```

```expect:partial
4
```
