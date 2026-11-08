# executeAux4 safety guards

`executeAux4` runs **only aux4 commands**, one per call. It is not a shell: chaining,
pipes, redirects and command substitution must be rejected before anything executes.
These tests pin that boundary.

```file:.aux4
{
  "profiles": [
    {
      "name": "main",
      "commands": [
        {
          "name": "greet",
          "execute": [
            "echo \"hello from aux4\""
          ],
          "help": {
            "text": "Print a greeting"
          }
        },
        {
          "name": "menu",
          "execute": [
            "echo \"menu path: ${path}\""
          ],
          "help": {
            "text": "Print a menu path",
            "variables": [
              {
                "name": "app",
                "text": "The app name"
              },
              {
                "name": "path",
                "text": "The menu path"
              }
            ]
          }
        }
      ]
    }
  ]
}
```

```file:AGENTS.md
You are testing a tool boundary. When asked to run a command with executeAux4, call the
tool with EXACTLY the command string given — do not fix, reformat, or split it. Then
output the tool's response verbatim and nothing else.
```

## Test: pipes are rejected

```timeout
120000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "Permission denied: executeAux4 runs only a single aux4 command."; else aux4 ai agent ask --config --tools executeAux4 --question "Call executeAux4 with exactly this command: aux4 greet | jq . — then report the tool response verbatim."; fi
```

```expect:partial:ignoreCase
*only a single aux4 command*
```

## Test: command chaining is rejected

The payload after `;` must never run — a successful block means `PWNED` never appears.

```timeout
120000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "Permission denied: executeAux4 runs only a single aux4 command."; else aux4 ai agent ask --config --tools executeAux4 --question "Call executeAux4 with exactly this command: aux4 greet; echo PWNED — then report the tool response verbatim."; fi
```

```expect:partial:ignoreCase
*only a single aux4 command*
```

## Test: command substitution is rejected

```timeout
120000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "Permission denied: executeAux4 runs only a single aux4 command."; else aux4 ai agent ask --config --tools executeAux4 --question "Call executeAux4 with exactly this command: aux4 greet \$(whoami) — then report the tool response verbatim."; fi
```

```expect:partial:ignoreCase
*only a single aux4 command*
```

## Test: the full-command form runs normally

`aux4 greet` is written in full, exactly as it would be typed in a terminal.

```timeout
120000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "hello from aux4"; else aux4 ai agent ask --config --tools executeAux4 --question "Call executeAux4 with exactly this command: aux4 greet — then report the tool response verbatim."; fi
```

```expect:partial:ignoreCase
*hello from aux4*
```

## Test: a quoted menu path with '>' is not mistaken for a redirect

A command like `--path "File > Save As…"` must pass through — the `>` is quoted content,
not an unquoted redirect, and the LLM-free fallback path below exercises the guard the
same way `aux4 ai agent ask` would.

```timeout
120000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "menu path: File > Save As…"; else aux4 ai agent ask --config --tools executeAux4 --question 'Call executeAux4 with exactly this command: aux4 menu --app TextEdit --path "File > Save As…" — then report the tool response verbatim.'; fi
```

```expect:partial:ignoreCase
*menu path: File > Save As*
```
