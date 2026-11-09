# aux4 ai agent tool

Run a built-in agent capability as an aux4 command. The model receives only
`executeAux4`; it discovers these commands through `aux4 ai agent tool --help` and
invokes them through `executeAux4`.

Each command takes a JSON object as its final positional argument. For example:

```bash
aux4 ai agent tool read-file '{"file":"AGENTS.md"}'
aux4 ai agent tool write-file '{"file":"notes.txt","content":"Hello"}'
```

## Commands

| Command | JSON fields |
|---|---|
| `read-file` | `file` (required), `offset`, `limit` |
| `write-file` | `file`, `content` (required) |
| `edit-file` | `file`, `old_string`, `new_string` (required), `replace_all` |
| `save-image` | `imageName`, `content` (required; base64 content) |
| `list-files` | `path`, `recursive`, `exclude` |
| `search-files` | `pattern` (required), `path`, `include`, `exclude`, `maxResults` |
| `create-directory` | `path` (required) |
| `remove-files` | `files` (required; a path or array of paths). Removes only paths created by the agent. |
| `search-context` | `query` (required), `storage`, `limit`, `source`, `embeddingsType`, `embeddingsConfig` |
| `ask-user` | `question` (required) |
| `current-date-time` | No fields; pass `{}` |
| `read-reference` | `file` (optional; omit to list references) |
| `read-skill` | `skill` (optional; omit to list skills) |
| `search-text` | `file`, `query` (required), `limit` |
| `aux4-skill` | `skill` (optional; omit to list installed skills) |

## Permissions and policy

These commands retain the built-in tool permission checks. File operations remain
restricted to permitted paths; `remove-files` also checks the agent-created-path
record. Policy guardrails continue to use the underlying operation names such as
`writeFile`, `removeFiles`, and `searchFiles`.

`executeAux4` permissions and policy apply to ordinary aux4 commands. Built-in tool
commands dispatch through the same `executeAux4` path, then enforce the operation's
own existing path permissions and policy rules.
