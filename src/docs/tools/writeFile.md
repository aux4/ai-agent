# writeFile

Your primary way to create a file. Call this tool to write content to disk — printing the
content, or the arguments, in your reply does not save anything.

Writes the whole file, so use it for new files and for complete rewrites. To change part of a
file that already exists, use `editFile`, which leaves the rest untouched.

Only within the current working directory. Parent directories are NOT created; use
`createDirectory` first.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | Yes | Path to write. Must be inside the working directory |
| `content` | string | Yes | Complete UTF-8 content of the file |

Returns `"file created"` on success.

Full details: `readReference("writeFile.md")`.
