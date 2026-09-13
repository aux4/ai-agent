# Read File Tool

Read the contents of any text-based file from the local disk.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | Yes | Path to the file to read. Supports relative, absolute, and tilde (`~`) paths |
| `offset` | number | No | Line number to start reading from (0-based). Use with `limit` to paginate large files |
| `limit` | number | No | Maximum number of lines to read |

## Pagination

For large files, use `offset` and `limit` to read in chunks:

```
readFile({ file: "large-output.txt", offset: 0, limit: 100 })   // first 100 lines
readFile({ file: "large-output.txt", offset: 100, limit: 100 }) // next 100 lines
```

When there are more lines after the returned chunk, the output includes:
`[Showing lines 1-100 of 5000. Use offset=100 to read more.]`

## Response Format

- **Success:** Returns file contents as UTF-8 text
- **File not found:** Returns `"File not found"`
- **Access denied:** Returns `"Access denied"`
- **Binary file:** Returns hint about the correct tool to use

## Security

- Allowed: current working directory, subdirectories, and `~/.aux4.config/packages`
- Restricted: files outside these locations
