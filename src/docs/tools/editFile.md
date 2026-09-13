# editFile

Replace exact text inside an existing file, leaving the rest untouched. Use this rather than
`writeFile` whenever the file already exists and you are changing part of it.

`old_string` must match the file EXACTLY, including indentation and newlines. If it appears
more than once the edit fails — either include surrounding lines to make it unique, or pass
`replace_all`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | Yes | File to edit. Must be inside the working directory |
| `old_string` | string | Yes | Exact text to find |
| `new_string` | string | Yes | Replacement. Empty string deletes the match |
| `replace_all` | boolean | No | Replace every occurrence instead of the first |

Returns `"file edited"` on success, or `"old_string not found in file"` when the text did not match.

Full details: `readReference("editFile.md")`.
