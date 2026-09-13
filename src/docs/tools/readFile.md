# readFile

Read a text file. Returns its contents.

Restricted to the working directory, `~/.aux4.config/packages`, and temp dirs. Binary files
(pdf, images, archives) are refused — for a PDF use `executeAux4("aux4 pdf parse <file>")`.

Use `offset`/`limit` to page through a large file; the reply says when more remains.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | Yes | Path to read. Relative, absolute or `~` |
| `offset` | number | No | First line to read (0-based) |
| `limit` | number | No | Maximum lines to read |

Full details: `readReference("readFile.md")`.
