# Execute Aux4 CLI Tool

Runs a single **aux4** command — exactly as you would type it in a terminal, including the leading `aux4`.

## How aux4 commands read

`aux4 <X>` means **"auxiliary for X"**:

- `aux4 git status` — auxiliary for git
- `aux4 google gmail list --query is:unread` — auxiliary for google
- `aux4 aux4 pkger list --filter gmail` — auxiliary for **aux4 itself** (package management, man pages, version). The repeated `aux4` is correct, not a typo.

Write the whole command, every time. Never strip the leading `aux4`.

```
executeAux4("aux4 aux4 pkger man aux4/aux4")
executeAux4("aux4 google gmail list --query is:unread")
```

## Discovering commands

Commands are grouped into profiles, so explore top-down:

1. `aux4 aux4 pkger list --filter <keyword>` — find the package that covers a capability
2. `aux4 --help` — list the top-level commands
3. `aux4 <command> --help` — a profile's subcommands, or a leaf command's flags
4. `aux4 <command> --whereIsIt` — which package a command comes from

## Limits

This tool runs **only aux4 commands** — one per call. It is not a shell: other programs,
pipes, redirects, and command chaining (`;` `&&` `||` `|` `` ` `` `$()` `>`) are rejected.
To post-process output, use the aux4 command's own flags, or read the result and reason
about it yourself.

For large-output handling, timeouts, stdin, and config, call `readReference("executeAux4.md")`.

## Parameters

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `command` | string | Yes      | The full aux4 command, e.g. `aux4 config get key` |
| `stdin`   | string | No       | Data to pass as stdin |
| `timeout` | number | No       | Timeout in seconds (default 60, 0 = no timeout) |
