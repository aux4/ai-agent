# listFiles

List files in a directory.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | string | No | Directory to list. Defaults to the current one. Supports `~` |
| `recursive` | boolean | No | Include subdirectories. Default true |
| `exclude` | string | No | Comma-separated prefixes to skip, e.g. `"node_modules,.git"` |

Exclude large directories such as `node_modules` when recursing.

Full details: `readReference("listFiles.md")`.
