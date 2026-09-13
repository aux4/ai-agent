# executeAux4 — detailed usage

Run any aux4 command. The tool runs `aux4 <command>`, so the `aux4` prefix is added for you.

## Command format

Provide the command **without** a leading `aux4`.

- Correct: `"pdf parse file.pdf"`, `"browser open --url https://example.com"`, `"config get key"`
- Wrong: `"aux4 pdf parse file.pdf"`, `"aux4 config get key"`

**Exception — the `aux4` namespace.** Package management, version, and man pages live under the `aux4` command itself, so they DO keep the `aux4` prefix (the full invocation is `aux4 aux4 ...`):

- `"aux4 version"` — show the aux4 version
- `"aux4 pkger list --filter <keyword>"` — search installed packages
- `"aux4 pkger man --package <scope/name>"` — a package's manual
- `"aux4 man <command>"` — a command's manual

## Discovering commands

- `"--help"` — list every top-level command
- `"<command> --help"` — a profile's subcommands, or a leaf command's flags (`"google gmail list --help"`)
- `"<command> --whereIsIt"` — which package a command belongs to
- `"aux4 pkger list --filter <keyword>"` — find the package for a capability by keyword

A good path: search by keyword with `aux4 pkger list --filter`, then drill in with `--help` until you reach the command and can read its flags.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `command` | string | Yes | The command to execute (without the `aux4` prefix) |
| `stdin`   | string | No | Data to pass as stdin |
| `timeout` | number | No | Timeout in seconds (default 60; 0 = no timeout) |

## Large output

When a command's output exceeds ~10KB it is truncated and you'll see `[Output truncated: ... written to <path>]`. Use `readFile` to read the full output from that path — do not work with truncated data.

## Timeout

Commands exceeding the timeout are transferred to a background job (if aux4/jobs is installed) — check with `"jobs status"` / `"jobs output <id>"`. For long-running commands (builds, API calls), raise the timeout or set `timeout: 0`.

## stdin

Use `stdin` for commands that read from standard input:
`executeAux4({ command: 'pdf fill "form.pdf" --out "filled.pdf"', stdin: '{"field": "value"}' })`

## Config

aux4 loads parameters from `config.yaml`: `"deploy --config dev"`, `"deploy --configFile custom.yaml --config staging"`.
