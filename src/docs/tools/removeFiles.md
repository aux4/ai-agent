# removeFiles

Delete files or directories **that this session created**. Anything the agent did not create
is refused — this tool cannot be used to clean up pre-existing files.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `files` | string \| array | Yes | Path, or list of paths, to remove |

Returns what was removed, or an explanation when a path was not created by this session.

Full details: `readReference("removeFiles.md")`.
