# executeAux4 shell-safety (AGC-016)

Regression test for the injection-class bug where backticks and `$( )` in
content passed through `executeAux4` (for example `kb add --content "..."`) were
shell-substituted and erased before aux4 saw them. `executeAux4` now parses the
command into an argv array and spawns `aux4` directly, with no shell, so every
metacharacter inside an argument value survives verbatim.

`executeAux4` is only invoked by the LLM at runtime, so it has no keyless CLI
entry point. This test runs a check script that exercises the exact code the
tool uses — the `buildAux4Argv` tokenizer plus a direct, shell-less `aux4` spawn
— and verifies backticks, `$( )`, `;`, `&&`, `|`, quotes, and newlines round-trip
through a real `aux4 kb add`. It needs no API key.

## content with shell metacharacters is not executed

### should preserve backticks, $(), ;, &&, |, quotes, and newlines verbatim

```execute
node executeaux4-shell-safety-check.mjs
```

```expect:partial
SHELL-SAFETY OK
```
