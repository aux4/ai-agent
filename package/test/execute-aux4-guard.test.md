# executeAux4 safety guards

`executeAux4` runs **only aux4 commands**, one per call, and it does **not** use a shell:
the command string is split into arguments with POSIX quoting rules (single quotes,
double quotes, backslash escapes) and `aux4` is spawned directly with that argv. Shell
operators (`;` `&&` `|` `>` backticks `$(...)`, newlines) have no meaning — they arrive as
literal argument text and nothing else ever runs. These tests drive the tool
deterministically through `run-tool` (no LLM). Single quotes inside the JSON tool call are
written as `\u0027` so the outer shell quoting of the test stays simple.

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
          "name": "show",
          "execute": [
            "log:url=${url}",
            "log:data=${data}"
          ],
          "help": {
            "text": "Print the url and data params exactly as received",
            "variables": [
              {
                "name": "url",
                "text": "A URL",
                "default": ""
              },
              {
                "name": "data",
                "text": "A JSON value",
                "default": ""
              }
            ]
          }
        }
      ]
    }
  ]
}
```

## Test: the full-command form runs normally

`aux4 greet` is written in full, exactly as it would be typed in a terminal.

```execute
aux4 ai agent run-tool '{"id":"g1","name":"executeAux4","arguments":{"command":"aux4 greet"}}' --tools executeAux4
```

```expect:partial
*"content":"hello from aux4*
```

## Test: the legacy stripped form still runs

```execute
aux4 ai agent run-tool '{"id":"g2","name":"executeAux4","arguments":{"command":"greet"}}' --tools executeAux4
```

```expect:partial
*"content":"hello from aux4*
```

## Test: a non-aux4 program is still refused

Only the leading `aux4` word is stripped; a command that names another binary becomes an
aux4 command path (`aux4 touch ...`), never a separate program.

```execute
aux4 ai agent run-tool '{"id":"g3","name":"executeAux4","arguments":{"command":"touch pwned-direct"}}' --tools executeAux4 && (ls pwned-direct 2>/dev/null || echo NOT-TOUCHED)
```

```expect:partial
*NOT-TOUCHED*
```

## Test: a URL with & ? = # is passed through literally

Unquoted `&`, `?`, `=` and `#` are ordinary characters — this is the USPS lookup URL the
old shell-operator guard refused.

```execute
aux4 ai agent run-tool '{"id":"u1","name":"executeAux4","arguments":{"command":"aux4 show --url https://tools.usps.com/zip-code-lookup.htm?byzipcode&zipcode=90292#top"}}' --tools executeAux4
```

```expect:partial
*url=https://tools.usps.com/zip-code-lookup.htm?byzipcode&zipcode=90292#top*
```

## Test: a single-quoted JSON --data value arrives intact

```execute
aux4 ai agent run-tool '{"id":"j1","name":"executeAux4","arguments":{"command":"aux4 show --data \u0027{\"zip\":\"90292\",\"note\":\"a b & c\"}\u0027"}}' --tools executeAux4
```

```expect:partial
*data={\"zip\":\"90292\",\"note\":\"a b & c\"}*
```

## Test: a double-quoted value with spaces and unicode is one argument

```execute
aux4 ai agent run-tool '{"id":"s1","name":"executeAux4","arguments":{"command":"aux4 show --url \"São Paulo — 東京 🚀 90292\""}}' --tools executeAux4
```

```expect:partial
*url=São Paulo — 東京 🚀 90292*
```

## Test: a --content value with newlines passes through

A KB markdown update carries the blank line Markdown needs inside double quotes. It must
reach the permission stage (a non-matching allow-list stops it there).

```execute
aux4 ai agent run-tool '{"id":"q1","name":"executeAux4","arguments":{"command":"aux4 cloud kb kb update --topic r2-3 --content \"a\n\n**Reviewed:** 2026-09-16\""}}' --tools executeAux4 --permissions '{"allow":["never-match"]}'
```

```expect:partial
*"content":"Permission denied: command *not allowed by the permissions configuration*
```

## Test: command substitution and backticks are literal text

`$(...)`, backticks and `$VAR` are never expanded — not even inside double quotes.

```execute
aux4 ai agent run-tool '{"id":"x1","name":"executeAux4","arguments":{"command":"aux4 show --url \"$(touch pwned-sub) `touch pwned-tick` $HOME\""}}' --tools executeAux4 && (ls pwned-sub pwned-tick 2>/dev/null || echo NOTHING-EXECUTED)
```

```expect:partial
*url=$(touch pwned-sub) `touch pwned-tick` $HOME*
NOTHING-EXECUTED
```

## Test: unquoted chaining, pipes, redirects and newlines never execute

`aux4 greet; touch pwned-1 ...` becomes one aux4 invocation with literal args (`greet;`,
`touch`, ...). aux4 has no such command, so it errors — and no file is ever created.

```execute
aux4 ai agent run-tool '{"id":"x2","name":"executeAux4","arguments":{"command":"aux4 greet; touch pwned-1 && touch pwned-2 || touch pwned-3 | touch pwned-4 > pwned-5 $(touch pwned-6) `touch pwned-7`\ntouch pwned-8"}}' --tools executeAux4 && (ls pwned-* 2>/dev/null || echo NOTHING-EXECUTED)
```

```expect:partial
*NOTHING-EXECUTED*
```

## Test: an unterminated quote is reported, not run

```execute
aux4 ai agent run-tool '{"id":"x3","name":"executeAux4","arguments":{"command":"aux4 show --url \"https://example.com"}}' --tools executeAux4
```

```expect:partial
*"content":"Invalid command: unterminated double quote*
```

## Test: permissions match the parsed command

A deny rule on `greet*` cannot be dodged by quoting the command word — once parsed,
`'gr''eet'` is `greet`.

```execute
aux4 ai agent run-tool '{"id":"p1","name":"executeAux4","arguments":{"command":"aux4 \u0027gr\u0027\u0027eet\u0027"}}' --tools executeAux4 --permissions '{"allow":["*"],"deny":["greet*"]}'
```

```expect:partial
*"content":"Permission denied: command *not allowed by the permissions configuration*
```

## Test: a deny rule wins over a wildcard allow

Written in the stripped form (`greet`), the deny must hold even though the full form
(`aux4 greet`) matches `allow: ["*"]`.

```execute
aux4 ai agent run-tool '{"id":"p2","name":"executeAux4","arguments":{"command":"aux4 greet"}}' --tools executeAux4 --permissions '{"allow":["*"],"deny":["greet"]}'
```

```expect:partial
*"content":"Permission denied: command *not allowed by the permissions configuration*
```

## Test: the system deny list matches the parsed command

```execute
aux4 ai agent run-tool '{"id":"p3","name":"executeAux4","arguments":{"command":"aux4 \u0027secret\u0027 \"get\" x"}}' --tools executeAux4
```

```expect:partial
*blocked by system security policy*
```
