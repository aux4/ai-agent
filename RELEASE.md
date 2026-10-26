# Release 1.3.0

## Features

- **Tool-call hooks that follow aux4 core's own hook standard (HARN-030).** `ask`/`chat` now
  accept `--hooks <file>`, a `{ "hooks": [...] }` file in the exact same shape as a package's
  own `hooks` array (`core/core.go` `Hook`): `command` pattern matching (`<profile>/<command>`,
  `*` per-segment wildcard, resolved via `aux4 <action> --whereIsIt` the way aux4 itself
  resolves it — never string-prefix guessing), a `params` match filter (`|` alternatives,
  missing param never matches, and — since a tool call can repeat a flag — a repeatable value
  matches if ANY of its values match), `order`, and `before`/`replace`/`after`/`error` phases.
  Each hook additionally names the tool it targets (`"tool": "executeAux4"` by default, or any
  other built-in tool by name — `writeFile`, `removeFiles`, ...). Steps are real aux4 execute
  steps, run by aux4 itself (a scratch one-command package, not a reimplemented mini-language);
  the same `profile:`/`stdin:` executors are blocked in a hook step. A failing `before` step
  blocks the call before it ever runs, returning its own message to the model as that call's
  result ("Blocked by hook: ..."); a `replace` hook substitutes its own output for the call
  entirely; `after`/`error` are best-effort observers that fire once the call (or its
  replacement) is decided, with one documented exception — a successful `after` step that
  prints non-empty stdout replaces the result (core's own `set:response=...` has no equivalent
  on a plain function return value, so this is the explicit substitute). Every call also gets
  `__tool`, `__command`, `__request` (this round's user request), `__history` (the history
  file, so a hook can read prior tool results) and `__session`, interpolated into hook steps
  as `${var}` exactly like a command's own declared variables. First consumer: agent/agent's
  value-provenance check runs as a `before` hook on `agent:browser/run` whenever a `--field`
  carries `confirm=yes`, replacing its own two-round confirmation gate.

# Release 1.2.7

## Fixes

- When an identical call is refused because it already failed the same way twice, and the
  failure is aux4's own parameter error (`Missing required parameter --X`, or
  `Unknown parameter --a, did you mean --b?`), the refusal now names the fix ("the call needs
  --messageId <value> ... rename that flag") instead of only "take a different route". Seen in
  dojo: a small model read the plain refusal and wandered off instead of changing the flag.

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
