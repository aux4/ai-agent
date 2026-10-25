# Release 1.2.6

## Features

- **Stop runaway identical tool-call loops, and recover from a stalled model (HARN-029).**
  Every bound tool now refuses a call made with the exact same arguments that already
  produced the exact same result twice in a row — the refusal quotes the repeated result
  and tells the model to change the call instead of repeating it. A changed call (different
  arguments) or a call whose result changes (legitimate polling) is never blocked. If the
  model ignores the refusal and keeps reissuing the identical call anyway, the run aborts
  after three refusals so the context cannot grow unbounded (dojo evidence: `aux4 google
  gmail get --id msg-ship-9f21` was called 59 times in one round, each time hitting the
  identical `Missing required parameter --messageId` error). Separately, a model response
  with no text and no tool calls (a stall, not a deliberate finish) is now retried, with a
  short nudge appended, up to two times before the run gives up and says so explicitly.

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
