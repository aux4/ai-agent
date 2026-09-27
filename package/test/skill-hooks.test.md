# generic skill hooks

Before an ask, `ai agent ask`/`chat` run `aux4 ai skill <name> hook-before --request <question>` for
every installed skill that implements it, and inject any non-empty output into the model's context
for that turn. After the ask completes, they run `aux4 ai skill <name> hook-after --request
<question> --history <historyFile>` and print any non-empty output after the answer. Neither hook is
specific to any one skill -- discovery is generic, driven only by whether a skill exposes a
`hook-before`/`hook-after` command.

These tests install a throwaway stub skill package that implements both hooks with deterministic
(non-LLM) output, so hook wiring can be asserted without live model calls. The `ask`/`chat` calls
themselves still need a real LLM, so they are skipped (printing `LLM-SKIPPED`) when no credentials
are configured, matching the other tests in this package.

```beforeAll
mkdir -p stub-skill/package
```

```afterAll
aux4 aux4 pkger uninstall aux4test/stub-hook-skill --force true 2>/dev/null || true
rm -rf stub-skill
```

```file:stub-skill/package/.aux4
{
  "scope": "aux4test",
  "name": "stub-hook-skill",
  "version": "0.0.1",
  "description": "Stub skill for testing generic skill hooks",
  "profiles": [
    {
      "name": "main",
      "commands": [
        {
          "name": "ai",
          "execute": ["profile:ai"],
          "help": { "text": "Artificial Intelligence" }
        }
      ]
    },
    {
      "name": "ai",
      "commands": [
        {
          "name": "skill",
          "execute": ["profile:ai:skill"],
          "help": { "text": "skill" },
          "private": true
        }
      ]
    },
    {
      "name": "ai:skill",
      "commands": [
        {
          "name": "stub-hook",
          "execute": ["profile:ai:skill:stub-hook"],
          "help": { "text": "Stub hook skill" }
        }
      ]
    },
    {
      "name": "ai:skill:stub-hook",
      "commands": [
        {
          "name": "hook-before",
          "execute": ["log:Always end your reply with the exact word STUBMARKER."],
          "help": {
            "text": "Test hook-before",
            "variables": [
              { "name": "request", "text": "The request text", "default": "" }
            ]
          }
        },
        {
          "name": "hook-after",
          "execute": ["log:STUB-SUGGEST: consider saving this task"],
          "help": {
            "text": "Test hook-after",
            "variables": [
              { "name": "request", "text": "The request text", "default": "" },
              { "name": "history", "text": "History file", "default": "" }
            ]
          }
        }
      ]
    }
  ]
}
```

```file:stub-skill/package/LICENSE
Apache-2.0
```

```file:stub-skill/package/README.md
# stub-hook-skill

Test fixture only.
```

## installed skill implementing hook-before and hook-after

### hooks fire around a live ask

```timeout
120000
```

```execute
aux4 aux4 releaser install --dir stub-skill/package --noBuild true --force true >/dev/null && if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "LLM-SKIPPED"; else aux4 ai agent ask --config --history hooks-history.json "Say hello in one short sentence."; fi
```

```expect:regex
(STUBMARKER[\s\S]*STUB-SUGGEST|LLM-SKIPPED)
```

### skillHooks false disables both hooks

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "LLM-SKIPPED"; else OUT=$(aux4 ai agent ask --config --skillHooks false --history hooks-history-2.json "Say hello in one short sentence."); if echo "$OUT" | grep -q "STUBMARKER\|STUB-SUGGEST"; then echo "HOOKS-LEAKED"; else echo "HOOKS-DISABLED-OK"; fi; fi
```

```expect:regex
(HOOKS-DISABLED-OK|LLM-SKIPPED)
```
