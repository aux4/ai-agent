# Release 1.3.2




## 1.3.5

- When aux4 answers "Command not found ... Did you mean: <path>", executeAux4 adds the exact call
  to make instead -- the suggested path with the agent's own arguments -- and the loop guard's
  refusal of a repeated not-found call says the same. A model that kept re-issuing a call under
  the wrong parent ("ai agent browser find") gets a ready-to-run correction.

## 1.3.4

- Neutral example value in the executeAux4 quoting docs (`price $9.99`).

## 1.3.3

- A hook that blocks the same command 3 times in one run ends the run (loop abort) with the
  block reason. Before, a model alternating "call with a made-up value" (blocked) and "call
  without it" kept going until its budget ran out (65 calls, 12 minutes).
- The loop guard also tracks a call's shape -- the same tool and command with entered `--field`
  values and session ids removed -- and the same answer coming back. After 4 identical answers it
  refuses, then aborts, like an exact repeat. Changing only the values no longer resets it.

## Fixes

- **`--tools` now actually filters which tools are bound (HARN-036).** `ask`/`chat` have
  documented `--tools` as "comma-separated allow-list of tools to bind" since it was added, but
  there was no implementation behind it -- every request bound every built-in tool regardless.
  Found via a dojo trace where Gemma 26B called `listFiles` on a denied folder ~500 times over 12
  minutes with nothing to stop it from even trying. `--tools` is now wired through
  `executable.js` -> `AskExecutor` -> `Prompt.js#init`, which filters the built-in + MCP tool pool
  down to the named list right before binding to the model (`ToolBindings.js`:
  `parseToolsAllowList`/`applyToolsAllowList`). An unknown name fails fast with an error listing
  the tools actually valid for that configuration. MCP tools share the same flat namespace as
  built-ins: unfiltered by default, matched by name when a list is given. Empty/unset is
  unchanged behavior.
- **A loop-guard abort now actually ends the run (HARN-036).** The tool-loop guard (1.2.6,
  `LOOP_ABORT_AFTER`) already refused a call repeated past its limit and threw a
  `err.loopAbort = true` error after enough refusals -- but `Prompt.js` caught every tool error
  identically, turned it into "Error executing tool ..." tool-message text, and recursed back into
  the model with the exact same (now slightly longer) context. A model that ignores the refusal
  got refused again, forever: the abort existed but never actually stopped anything, which is
  exactly how a dojo run burned 12 minutes on a single denied call. A `loopAbort` error now ends
  the run instead of recursing: the refusal is still recorded in history, but the run returns a
  final answer stating it stopped because it kept repeating a refused call, naming the call and
  its last result (same normal-exit path as the existing stall-recovery guard, not a thrown
  process error).
- Confirmed and left unchanged: the policy `budget.calls` cap only counts consequential tool
  calls (`executeAux4`, `writeFile`, `editFile`, `removeFiles`, `createDirectory`, `saveImage`) --
  this is the documented, deliberate scope (`Policy.js`'s own top-of-file comment and the README's
  "per-run consequential tool call cap"), not a gap to close. Read-only tool loops are caught by
  the loop guard above instead, which is tool-agnostic.

# Release 1.3.1

## Fixes

- **Short, model-facing tool descriptions (HARN-032).** Every built-in tool's `description` --
  the text actually sent to the model on every call -- was previously the full human-readable
  markdown doc from `src/docs/tools/*.md` (parameter tables duplicating the zod schema,
  emoji "when to use" lists, response-status tables, implementation details like `fs.rmSync`),
  roughly 50KB / ~13K tokens across 14 tools. Descriptions are now short (2-6 sentences, under
  ~600 chars; `executeAux4` a bit longer since its quoting rules matter) and live in
  `src/docs/tools/descriptions.js`. The long docs in `src/docs/tools/*.md` are unchanged and
  still linked from the README/man pages as human documentation -- they are just never loaded
  into the prompt anymore. Behavior and tool names are unchanged.
- **Tools are only bound when their backing resource is actually configured.** `createTools()`
  previously always bound `searchContext`, `readReference`, and `readSkill` even when no vector
  store, references directory, or skills directory existed -- costing prompt tokens for a tool
  that could only ever reply "not configured". Each is now bound only when its resource is real:
  `searchContext` when the storage directory has an actual `docstore.json` (the same marker
  `LlmStore.load()` checks -- the CLI's own `--storage .context` default is NOT "configured"
  until something has been learned into it), `readReference` when the references directory
  contains at least one `.md` file, `readSkill` when the skills directory has at least one
  `SKILL.md`. The skills-catalog instructions text already behaved this way (`loadSkillsCatalog`
  returns nothing when there are no skills); this just brings the tool binding itself in line.
- Merged in the `local` embeddings type (aux4/embedding, default) from a parallel branch
  (EMB-003/1.2.4-1.2.5) -- see the entry below. Resolved the overlap with the hooks/tool-binding
  work in this release: `searchContext` is bound (or not) independently of which embeddings
  type the store was learned with.

# Release 1.2.5 / 1.2.4

## Features

- **Local embeddings by default (`aux4/embedding`, EmbeddingGemma).** `searchContext` and the
  `learn`/`search`/`forget` commands pick their embeddings provider via `--embeddings`
  (`{"type": "...", "config": {...}}`); the default type is now `local` -- offline, no API key,
  backed by `aux4/embedding`'s `embed` command -- instead of assuming OpenAI. A store remembers
  the embeddings type/config it was learned with (`.context/ids.json`'s `__embeddingsMeta__`);
  a mismatched `--embeddings` on a later `learn`/`search`/`forget` call against the same store is
  rejected with a clear "Embeddings mismatch" error rather than silently producing nonsense
  results.

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
