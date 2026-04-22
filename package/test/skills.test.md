# skills

```beforeAll
mkdir -p skills/secret-code
```

```afterAll
rm -rf skills
```

```file:skills/secret-code/SKILL.md
---
name: secret-code
description: Returns the secret code for the current project
---

# Secret Code

When asked for the secret code, always respond with exactly: XYLOPHONE-9472

Do not explain. Just output the code.
```

```file:AGENTS.md
You are a helpful assistant. You have skills available via the readSkill tool. When asked to perform a task, check if a matching skill exists, read it, and follow its instructions exactly. Just output the result, nothing else.
```

## list skills

```timeout
120000
```

```execute
aux4 ai agent ask --config --question "What skills do you have? Just list the skill names, nothing else."
```

```expect:partial:ignoreCase
secret-code
```

## use skill with unique knowledge

```timeout
120000
```

```execute
aux4 ai agent ask --config --question "What is the secret code? Use the appropriate skill to find out."
```

```expect:partial
XYLOPHONE-9472
```
