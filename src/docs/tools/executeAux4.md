# Execute Aux4 CLI Tool

Run any aux4 command. Do NOT include the `aux4` prefix — just provide the command and arguments.

## Parameters

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `command` | string | Yes      | The aux4 command to execute (without the `aux4` prefix) |
| `stdin`   | string | No       | Data to pass as stdin |
| `timeout` | number | No       | Timeout in seconds (default: 60, 0 = no timeout) |

## Command Format

**Correct:** `"aux4 version"`, `"aux4 pkger list"`, `"browser start"`
**Wrong:** `"pkger list"`, `"help"`, `"version"`

aux4 has a built-in command called `aux4` that provides package management and system tools. Commands under this namespace use the `aux4` prefix:
- `"aux4 version"` — show aux4 version
- `"aux4 pkger list"` — list installed packages
- `"aux4 pkger list --filter name"` — search packages
- `"aux4 pkger install scope/package"` — install a package
- `"aux4 pkger uninstall scope/package"` — uninstall a package
- `"aux4 pkger man scope/package"` — view package docs
- `"aux4 man command"` — show command manual

All other commands are called directly by their name (e.g., `"browser start"`, `"pinterest pin list"`, `"config get key"`).

## Discovery

Use `--help` to explore any command:
- `""` — list all top-level commands
- `"command --help"` — show help for a command
- `"command subcommand --help"` — show help for a subcommand

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
