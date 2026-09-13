# Search Text Tool

Find the relevant parts of one large file without reading all of it.

## Overview

Reach for this when a command's output was truncated. The truncation message gives the path to the
full output; ask this tool for the part you actually need instead of paging through the file.

It splits the file into passages and ranks them against your words, returning the best ones with
their line numbers.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | Yes | Path to the file to search — e.g. the path given in a truncation message. |
| `query` | string | Yes | What you are looking for, in words. Describe the thing, not its exact spelling. |
| `limit` | number | No | Maximum passages to return. Defaults to 5. |

## When to Use This Tool

- A command's output was truncated and the part you need was in the omitted middle
- You want one section of a long `--help` — the subcommand list, or the flags of one subcommand
- A file is too large to read but you know roughly what you are looking for

## Response Format

Ranked passages, each with the line it starts at:

```
[line 42]
  open
  Open a new browser session. Returns a session ID for subsequent commands.
```

Use the line number with `readFile --offset` if you need the surrounding context.

## Notes

- Ranking is by word overlap, so a query of a few plain words works better than a long sentence.
- It searches one file. To search across files, use `searchFiles`.
