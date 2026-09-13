# searchFiles

Find which files contain a piece of text. Case-insensitive substring match; returns the
matching lines with their file and line number.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `pattern` | string | Yes | Text to search for |
| `path` | string | No | Directory to search. Defaults to the current one |
| `include` | string | No | Extensions to search, e.g. `"js,ts,md"` |
| `exclude` | string | No | Prefixes to skip, e.g. `"node_modules,.git"` |
| `maxResults` | number | No | Cap on matching lines (default 50) |

Full details: `readReference("searchFiles.md")`.
