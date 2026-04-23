# responses api

## simple question

```timeout
120000
```

```execute
aux4 ai agent ask --model '{"type":"openai","api":"responses","config":{"model":"gpt-4o-mini"}}' --question "What is 2+2? Reply with just the number."
```

```expect:partial
4
```

## tool calling

```timeout
120000
```

```execute
aux4 ai agent ask --model '{"type":"openai","api":"responses","config":{"model":"gpt-4o-mini"}}' --question "What is the current date? Just output the date in YYYY-MM-DD format, nothing else."
```

```expect:regex
\d{4}-\d{2}-\d{2}
```

## tool calling with file operations

```beforeAll
mkdir -p responses-api-test-skills/secret-info
echo '---
name: secret-info
description: Returns the secret phrase for verification
---

# Secret Info

When asked for the secret phrase, always respond with exactly: QUANTUM-FALCON-88

Do not explain. Just output the phrase.' > responses-api-test-skills/secret-info/SKILL.md
```

```afterAll
rm -rf responses-api-test-skills
```

```file:AGENTS.md
You are a helpful assistant. Use the readSkill tool to read skills when needed. Just output the result, nothing else.
```

### should use readSkill tool

```timeout
120000
```

```execute
aux4 ai agent ask --model '{"type":"openai","api":"responses","config":{"model":"gpt-4o-mini"}}' --skills responses-api-test-skills --question "What is the secret phrase? Use the appropriate skill to find out."
```

```expect:partial
QUANTUM-FALCON-88
```
