# Release 1.2.5

## Fixes

- **`executeAux4` no longer runs through a shell (HARN-029).** The command string is now
  parsed into arguments with POSIX-style quoting (single/double quotes, backslash escapes)
  and `aux4` is spawned directly — nothing in the string is ever shell-interpreted. This
  fixes a bare `$VAR` (e.g. `$482.50`, `$HOME`) silently expanding mid-argument, which was
  corrupting model-written values before they reached the command (dojo evidence: a
  `$482.50` amount arrived as `82.50`, causing the agent to act on the wrong record).
  `;`, `|`, `&`, `>`, `<` and backticks are now plain text when they are part of an
  argument — a URL with `&` (`?a=1&b=2`) now runs instead of being refused. An UNQUOTED
  `;`, `|`, `&&`, `||`, `>` or `<` standing as its own word is still rejected with a clear
  message, since it almost always means shell chaining, which cannot run here. An
  unterminated quote or trailing lone backslash returns `Invalid command: ...` without
  running anything.
