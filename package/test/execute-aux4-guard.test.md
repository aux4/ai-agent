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

# executeAux4 quote-aware operator guard

The control-operator guard masks single- and double-quoted spans before it looks for
shell operators, so a `;`, `|`, `&&`, newline, backtick or `$(...)` **inside quotes** is
treated as ordinary argument text (exactly how `sh -c` reads it), while the same
characters **unquoted** are still rejected. These tests drive the guard deterministically
through `run-tool` — no LLM. A validation-passing command is deliberately paired with a
non-matching `--permissions` allow-list so it stops at the permission stage; reaching that
stage proves validation let it through.

## Test: a --content value with newlines passes validation

A KB markdown update — `--content "a\n\n**Reviewed:** 2026-09-16"` carries the blank line
Markdown needs. The embedded newline lives inside double quotes, so it must NOT trip the
guard. Passing validation, the command is stopped by the permission allow-list instead of
the shell-operator message.

```execute
aux4 ai agent run-tool '{"id":"q1","name":"executeAux4","arguments":{"command":"aux4 cloud kb kb update --topic r2-3 --content \"a\n\n**Reviewed:** 2026-09-16\""}}' --tools executeAux4 --permissions '{"allow":["never-match"]}'
```

```expect:partial
*"content":"Permission denied: command *not allowed by the permissions configuration*
```

## Test: an unquoted semicolon is still rejected

```execute
aux4 ai agent run-tool '{"id":"q2","name":"executeAux4","arguments":{"command":"aux4 kb list; rm -rf /"}}' --tools executeAux4
```

```expect:partial
*"content":"Permission denied: executeAux4 runs only a single aux4 command. Shell operators*
```

## Test: operators inside quotes pass validation

`--content "a; b && c"` — the `;`, `&&` are inside double quotes, so they are argument
text, not chaining. Validation passes; the permission allow-list stops it.

```execute
aux4 ai agent run-tool '{"id":"q3","name":"executeAux4","arguments":{"command":"aux4 x --content \"a; b && c\""}}' --tools executeAux4 --permissions '{"allow":["never-match"]}'
```

```expect:partial
*"content":"Permission denied: command *not allowed by the permissions configuration*
```

## Test: an unquoted && is still rejected

```execute
aux4 ai agent run-tool '{"id":"q4","name":"executeAux4","arguments":{"command":"aux4 a && aux4 b"}}' --tools executeAux4
```

```expect:partial
*"content":"Permission denied: executeAux4 runs only a single aux4 command. Shell operators*
```
