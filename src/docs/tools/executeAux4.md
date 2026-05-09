# Execute Aux4 CLI Tool

Run any aux4 command. The `aux4` prefix is added automatically — just provide the command name and arguments.

## Parameters

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `command` | string | Yes      | The command to execute (without `aux4` prefix) |
| `stdin`   | string | No       | Data to pass as stdin |
| `timeout` | number | No       | Timeout in seconds (default: 60, 0 = no timeout) |

## Command Format

The tool runs `aux4 <your command>`. Do NOT add `aux4` yourself.

**Correct:** `"pdf parse file.pdf"`, `"browser open --url https://example.com"`, `"config get key"`
**Wrong:** `"aux4 pdf parse file.pdf"`, `"aux4 browser open"`, `"aux4 config get key"`

The only exception is `aux4` subcommands (package management, version, man pages) which live under the `aux4` namespace:
- `"aux4 version"` — show aux4 version
- `"aux4 pkger list"` — list installed packages
- `"aux4 man command"` — show command manual

These require `aux4` because `aux4` is the command name, making the full invocation `aux4 aux4 version`.

## Discovery

Use `--help` to explore any command:
- `"--help"` — list all top-level commands
- `"pdf --help"` — show help for pdf
- `"browser open --help"` — show help for browser open

## Large Output

When a command produces output larger than 10KB, the result is truncated and you'll see:
`[Output truncated: X bytes total. Full output was written to /tmp/path/to/file]`

**When this happens, use `readFile` to read the full output from the temp file path.** Do not work with truncated data — always read the full file.

## Timeout Behavior

Commands that exceed the timeout are automatically transferred to a background job (if aux4/jobs is installed). Use `"jobs status"`, `"jobs output <id>"` to check.

For long-running commands (builds, API calls), increase the timeout or set `timeout: 0`.

## Passing stdin

Use the `stdin` parameter for commands that read from stdin:
```
executeAux4({ command: 'pdf fill "form.pdf" --out "filled.pdf"', stdin: '{"field": "value"}' })
```

## Configuration

aux4 supports loading parameters from `config.yaml`:
```
"deploy --config dev"
"deploy --configFile custom.yaml --config staging"
```
