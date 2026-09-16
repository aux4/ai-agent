# Release 1.3.10

## Fixes

- **executeAux4 control-operator guard is now quote-aware.** The guard that blocks shell
  operators (`;` `&&` `||` `|` `` ` `` `$()` `<(` `>` `<`, newlines) previously tested the
  entire raw command string, so any aux4 command whose quoted argument legitimately
  contained one of those characters — e.g. `aux4 kb update --topic x --content "line one\n\nline two"`,
  where the blank line is required for KB markdown — was rejected before it ran, even though
  `sh -c` treats a character inside a quoted span as ordinary argument text. The guard now
  masks single- and double-quoted spans to a neutral placeholder before testing for
  operators, so control characters **inside quotes** no longer trip it, while truly
  **unquoted** `;`, `&&`, `||`, `|`, backticks, `$()`, and redirects are still rejected.
  The rejection message and behavior for real violations are unchanged.

## Tests

- Added deterministic guard tests (via `ai agent run-tool`, no LLM) covering: a `--content`
  value with embedded newlines passing validation, operators inside quotes passing, and
  unquoted `;` / `&&` still being rejected.
- Refreshed the `run-tool` result-envelope expectations to include the `name` field.
