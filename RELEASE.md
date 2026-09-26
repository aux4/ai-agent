# Release 1.3.18

## Changes

- **`executeAux4` no longer uses a shell (CBR-054).** The command string is parsed into
  arguments (POSIX quoting: single/double quotes, backslash escapes) and `aux4` is spawned
  directly. No expansion of any kind (`$VAR`, `$(...)`, backticks, globs, `~`). Shell
  operators are plain argument text, so the operator-rejection guard is gone — a URL with
  `&` (e.g. a USPS ZIP lookup URL) now runs instead of being refused, and `aux4 x; rm -rf /`
  runs only `aux4` with literal arguments. An unterminated quote returns
  `Invalid command: ...` without running anything. Inside double quotes, `$VAR` is no longer
  expanded (it was, under `sh -c`).

## Fixes

- **Deny rules win.** A command denied in one form (e.g. `hello`) is no longer allowed just
  because the other form (`aux4 hello`) matched `allow: ["*"]`. Permission and system-deny
  patterns are also matched against the parsed command, so `aux4 'secret' get` is blocked
  like `aux4 secret get`.

# Release 1.3.17

## Changes

- **Per-command `executeAux4` timeouts (CBR-048).** `permissions.timeouts` (or the host's
  `AUX4_AGENT_TOOL_TIMEOUTS` JSON env) maps command patterns to seconds, e.g.
  `{"aux4 cloud browser *": 280}`; a match raises the 60s default or a shorter timeout the
  model asked for. A longer timeout or `0` from the model is kept.
- **No `jobs run` advice where aux4/jobs is not installed.** A timed-out command is only handed
  to (or pointed at) `aux4 jobs` when the package is installed; otherwise the message asks for
  one retry with a longer timeout. `AUX4_AGENT_JOBS_AVAILABLE=true|false` overrides the check.

# Release 1.3.16

## Fixes

- **Compaction keeps the question it just answered (AGC-019).** Auto-compaction runs right
  after an answer, and with a small `keepLastMessages` (or a tool-heavy turn) the kept tail
  could start mid-turn — a bare tool result and the answer — with the question folded into
  the summary. The kept tail now always starts at the latest user message, even if that
  keeps more than `keepLastMessages`.

# Release 1.3.15

## Features

- **Auto-compaction no longer loses the conversation (AGC-019).** Before the history file is
  compacted, the full history as it was is written next to it as
  `<history without .json>.<YYYYMMDDHHMMSS>.json` (UTC). If that archive cannot be written,
  the compaction is skipped. The summary message gains `archive` (the archive file name),
  `compactedAt` (ISO time) and `compactedCount` (how many conversation messages it replaces),
  alongside the existing `compacted: true`. `aux4 ai agent compact` archives the same way and
  now also accepts the `{messages, tokenUsage}` history shape (the file keeps its shape).
- Tool rounds that compaction folds into text are marked `condensed: true`, so a chat can tell
  them from real replies.

All fields are additive: histories written by earlier versions load unchanged.

## Fixes

- Compaction on the Gemini CLI path now actually uses the Gemini CLI API for the summary (the
  option was never forwarded).

# Release 1.3.12

## Fixes

- **Tool-call history no longer stores the raw LangChain envelope (SFA-167).** An
  `assistant_with_tool` checkpoint used to persist the model's `AIMessage` verbatim — the
  `lc`/`type`/`id` constructor wrapper, `response_metadata`, `usage_metadata`,
  `model_provider`/`model_name` and `invalid_tool_calls: []` — roughly 10.5x the useful
  payload (measured 1,021 B stored per 97 B of signal). It is now stripped to
  `{ content, tool_calls: [{ id, name, args }] }` before being written, so persisted and
  seeded history carry only what the provider round trip actually needs. Legacy histories
  that still contain the full envelope continue to load unchanged (both shapes are accepted
  on read, including in the `history` view, compaction, and the Codex/Gemini-CLI paths).

- **Identical failing tool calls no longer loop forever (SFA-159).** A tool error is just
  text to the model, so a broken command could be re-planned unchanged indefinitely — one
  incident reissued the exact same failing call 71 times over 6m44s, burning ~72 inferences
  and baking 148 junk messages into durable history. When the same tool call (name + arguments)
  produces the byte-identical result three times in a row, `resume` now appends synthetic
  guidance to the latest tool result telling the model not to retry verbatim and to either
  report the error or change approach. Detection runs on the rehydrated history, so it works
  across the separate-process plan/run-tool/resume turns of the Step Functions loop.
  Legitimate retries that change arguments, and calls that finally succeed, are unaffected.

## Tests

- Live round-trip tests (mlx, gated on `AUX4_TEST_MLX`) proving the stripped checkpoint
  persists without the envelope, resumes correctly across a process boundary with the tool
  result paired by `tool_call_id`, and that legacy full-envelope histories still resume. Adds
  a byte-size assertion for the reduction.
- Loop-guard tests proving three identical failing rounds inject the guidance while a retry
  with different arguments and a call that finally succeeds do not.
