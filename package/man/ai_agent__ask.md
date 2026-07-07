#### Description

Ask a single question to the AI agent. The agent composes the prompt using an instructions file, optional conversation history, optional images, and retrieves relevant documents from the local vector store when configured. The response is printed to stdout.

Key features:

- **Agent identity** — give the agent a persona with `--bio` (a JSON object with `name`, `role`, `description`); it is rendered as a `# Agent Identity` system section so the agent knows who it is
- **Base instructions** — prepend an immutable base-prompt layer with `--baseInstructions <file>`, loaded before the main `--instructions` file
- **Prompt instructions** — load a custom instructions file to shape the assistant's behavior
- **Context from stdin** — pipe additional context into the prompt with `--context true`
- **Image input** — attach one or more images for visual question answering
- **Conversation history** — maintain multi-turn conversations via a history JSON file
- **Structured output** — constrain responses to a JSON schema
- **Streaming** — print tokens as they arrive with `--stream true`
- **Built-in tools** — the agent can call tools (readFile, writeFile, editFile, searchFiles, executeAux4, askUser, etc.) during execution
- **askUser tool** — when the agent needs clarification it can prompt the user; on a TTY it asks interactively, and in a non-interactive session it parks the question (see below)
- **Human-in-the-loop parking** — with `--humanInLoop park` (the default), a no-TTY `askUser` call or a permission `ask:` prompt suspends the run instead of silently auto-proceeding/auto-denying: the question is recorded in the history file, a structured `AUX4_PENDING_QUESTION` marker is emitted for a supervisor, and the turn ends with exit code `10`. Re-run with `--answer` (or the next question) to resume
- **Permissions** — control which aux4 commands and file operations the agent can perform using allow/ask/deny pattern lists
- **Policy guardrails** — an optional, enforced, swappable layer on top of permissions: per-run token/cost/call budgets, narrowing allow/deny rules, and escalation triggers (see `--policy`)
- **Loop budget** — a safety cap on the tool-execution loop: an always-on iteration cap (`--maxIterations`, default 50) plus optional token/time caps (`--budget`). When a limit trips the loop stops cleanly, appends a `[budget-exceeded]` note, persists history, and exits with code 7
- **History session locking** — when `--history <file>` is used, the run takes a real advisory lock (`<file>.lock`) held for its entire duration, so concurrent runs (a heartbeat firing during a long ask, two parallel agents) can never clobber or drop turns. On contention the default is to fail fast with a clear error and exit code 8; `--waitLock <duration>` opts into poll-waiting. History is written atomically (temp file + rename)
- **Model selection** — choose a named model from a registry with `--useModel` instead of passing inline model JSON
- **Codex** — set `api: codex` in the model config to use OpenAI models with your ChatGPT subscription via `~/.codex/auth.json`

#### Usage

```bash
aux4 ai agent ask [--baseInstructions <file>] [--instructions <file>] [--bio <json>] [--role <role>] [--history <file>] [--waitLock <duration>] [--staleLock <duration>] [--outputSchema <file>] [--context <true|false>] [--image <paths>] [--storage <dir>] [--stream <true|false>] [--autoCompact <true|false>] [--compaction <json>] [--permissions <json>] [--policy <json>] [--runId <id>] [--costs <json>] [--maxIterations <n>] [--budget <json>] [--models <json>] [--useModel <name>] [--references <dir>] [--skills <dir>] [--humanInLoop <park|auto>] [--answer <text>] <question>
```

--baseInstructions  Base instructions file loaded before the main instructions — an immutable base-prompt layer (default: "")
--instructions   Prompt instructions file (default: AGENTS.md; falls back to AGENT.md then instructions.md if not found)
--bio            Agent identity as a JSON object with name, role, description — rendered as a `# Agent Identity` system section (default: "")
--role           Role used in the prompt (default: user)
--history        History JSON file for multi-turn conversations (default: "")
--waitLock       How long to wait for a busy history lock before failing, e.g. 30s, 5m (default: "" = fail fast with exit code 8)
--staleLock      Age since last refresh past which a history lock is considered abandoned and stolen, e.g. 10m, 1h (default: 30m)
--outputSchema   JSON schema file to constrain structured output (default: schema.json)
--context        Read additional context from stdin (default: false)
--image          Image path(s), comma-separated for multiple (default: "")
--storage        Storage directory for the vector store (default: .context)
--stream         Enable streaming token output (default: false)
--autoCompact    Enable auto-compaction of conversation history (default: false)
--compaction     Compaction configuration as JSON (default: {})
--permissions    Permissions config as JSON with allow, ask, deny arrays (default: {})
--policy         Optional guardrail policy as an inline object with budget/allow/deny/escalate, delivered as JSON (default: "")
--runId          Optional run identifier injected into escalation commands as ${runId}; auto-generated when empty (default: "")
--costs          Optional cost rates as JSON (costIn, costOut, costCache per 1M tokens) used for the policy usd budget (default: {})
--maxIterations  Maximum number of tool-loop iterations before the loop is stopped — safety cap against runaway tool loops (default: 50)
--budget         Optional loop budget as JSON (maxIterations, maxTokens, maxTimeMs); overrides --maxIterations and adds optional token/time caps (default: {})
--models         Models registry as JSON (default: {})
--useModel       Named model from registry to use for this request; falls back to default model if name is not found (default: "")
--references     Path to the references directory (default: ${packageDir}/references)
--skills         Path to the skills directory (default: skills)
--humanInLoop    How to handle a no-TTY askUser / permission ask: `park` (suspend and record the question) or `auto` (legacy auto-proceed/auto-deny) (default: park). Requires `--history` to persist against; with no history it falls back to `auto`
--answer         Answer to a parked question when resuming. When omitted on a resume, the question itself is treated as the answer (default: "")
question         The question to ask (positional argument)

Permissions control which aux4 commands and file operations the agent can perform. Patterns are evaluated in order: deny, ask, allow. Command patterns match tool executions (e.g., `hello`, `deploy*`). File patterns use the format `file:<scope>:<glob>` where scope is `read`, `write`, or `delete` (e.g., `file:write:*.env`, `file:read:*`). See the Permissions section in the README for full details.

Policy guardrails (`--policy`) add an optional, enforced layer on top of permissions. The effective permission for a tool is the static permissions **intersected** with the policy — a policy can only narrow, never grant. Only consequential tools (`executeAux4`, `writeFile`, `editFile`, `removeFiles`, `createDirectory`, `saveImage`) are gated; read-only tools are exempt. The policy is an inline object (aux4 delivers a config object as JSON automatically) and supports a per-run `budget` (`tokens`/`usd`/`calls`, read from the live token usage the run already maintains — no separate ledger), `allow`/`deny` rule lists, and `escalate` triggers (`block`/`notify` modes running any aux4 command with injected `${trigger}/${reason}/${agent}/${runId}/${action}/${spent}/${cap}/${escalationId}/${json}` variables). `${runId}` is auto-generated when `--runId` is not passed. When `--history` is set, each policy decision is recorded on the corresponding tool entry as a `policy` field. With no `--policy`, behavior is unchanged. See the Policy Guardrails section in the README, and `aux4 ai agent policy check` / `aux4 ai agent policy resolve`.

Auto-compaction requires both `--autoCompact true` and a `compaction` config with `contextWindow` set. When prompt tokens exceed the threshold (`contextWindow * maxContextPercent / 100`), older messages are automatically summarized.

Compaction config fields:
- `contextWindow` — model's context window size in tokens (required)
- `maxContextPercent` — trigger threshold as percentage (default: 85)
- `keepLastMessages` — recent messages to keep verbatim (default: 6)
- `model` — optional model config for summarization (defaults to main model)

**Loop budget (`--maxIterations` / `--budget`):** The agent runs a tool-execution loop — invoke the model, run the tools it requests, feed results back, repeat — until the model stops asking for tools. The loop budget caps that loop so a misbehaving model cannot run forever. It applies to every ask and to every execute path (the standard LangChain path and the Codex path). Set the iteration cap with the simple `--maxIterations` flag (default 50), or supply a `--budget` JSON object for finer control; values in the `budget` object take precedence over the flag.

Budget config fields:
- `maxIterations` — hard cap on tool-execution rounds (always on; default 50)
- `maxTokens` — optional cap on total tokens consumed during the ask (default: no limit)
- `maxTimeMs` — optional cap on wall-clock time spent in the loop (default: no limit)

When any limit trips, the loop terminates cleanly rather than being abandoned: a final assistant note prefixed with `[budget-exceeded]` is appended (naming the limit and the tools the agent was about to call), the conversation history and accumulated token usage are persisted (when `--history` is set), that note is returned as the answer, and the command exits with code **7** (distinct from a generic failure) so a supervising process can detect the truncation and, for example, resume with a higher budget or escalate to a human.

**History session locking (`--waitLock` / `--staleLock`):** The history file is the agent's session store — the `ask`/`chat` loop rewrites it after every step. When two runs touch the same history at once (a heartbeat firing during a long ask, two parallel agents, a chat session while a cron ask runs), unguarded writes can corrupt or silently drop turns. To prevent that, every run with `--history` acquires a real advisory lock at start: a `<history>.lock` file (recording pid, host, and timestamp) created atomically, held for the whole run, refreshed on every save, and released on all exit paths (normal exit, error, and SIGINT/SIGTERM/SIGHUP).

- **Contention (default: fail fast).** If the history is already locked by a live, non-stale owner, the command prints `Error: history in use by pid <N> ... since <time>` and exits with code **8** — distinct from a generic failure (1) and from the loop-budget code (7) so a supervisor can tell "history in use" apart from a real error. It never silently proceeds.
- **Waiting (`--waitLock <duration>`).** Opt into poll-waiting for the lock to free. Durations accept `ms`/`s`/`m`/`h` suffixes (e.g. `30s`, `5m`) or a bare number of milliseconds. If the lock does not free within the window, the command still fails with exit code 8.
- **Stale locks (`--staleLock <duration>`).** A lock whose same-host owner process is gone (dead pid), or that has not been refreshed within the stale threshold (default **30m**), is presumed abandoned and stolen with a `[lock] stealing stale history lock ...` warning — so a crashed run can never wedge a history file forever. Because each save refreshes the lock, the threshold is really a "no progress for this long" cap, not a cap on total run time.

Atomic writes back this up: the history is written to a sibling temp file and renamed into place, so a reader (or a crashing writer) never observes a half-written history. This replaces the previous best-effort size heuristic.

**Agent identity (`--bio`):** Pass a JSON object describing who the agent is. The recognized fields are `name`, `role`, and `description`. When present, they are rendered as a `# Agent Identity` system section (bold `**Name:**` / `**Role:**` / `**Description:**` lines) and injected at the top of the system prompt — above the base instructions and the main instructions — so the agent consistently knows its persona. An empty or omitted `--bio` adds nothing. When stored in a config file under a top-level `bio:` key, aux4 delivers it as JSON automatically.

**Base instructions (`--baseInstructions`):** Pass a path to a file whose contents are loaded as system instructions **before** the main `--instructions` file. This is the immutable base-prompt layer: shared, always-on discipline that should not be overridden by the per-task instructions layered on top. The load order is: agent identity (`--bio`) → base instructions (`--baseInstructions`) → main instructions (`--instructions`).

**Skills directory:** When `--skills` points to a directory containing skill definitions, the agent discovers available skills at startup and can read their full instructions on demand using the `readSkill` tool. Each skill is a subdirectory with a `SKILL.md` file containing YAML frontmatter (`name`, `description`) and markdown instructions. See the Skills section in the README for the folder structure.

**Human-in-the-loop (`--humanInLoop`):** On a TTY, the `askUser` tool and permission `ask:` prompts always ask interactively — behavior is unchanged. Without a TTY (cron heartbeat, jobs, CI), the mode decides what happens:

- `park` (default): the run **suspends** on the first `askUser` question or permission `ask:` prompt. The pending question — its text, the tool that asked, and (for permissions) the requested command/file — is recorded in the `--history` file under `pendingQuestion`, a single-line `AUX4_PENDING_QUESTION <json>` marker is written to stderr for a supervisor to parse, and the process exits with code `10`. Nothing is auto-proceeded and nothing is auto-denied.
- `auto`: the legacy behavior — a no-TTY `askUser` returns "proceed with best judgment" and a no-TTY permission `ask:` is denied.

Parking requires `--history` (there must be somewhere to record the question and resume from); with no history file the mode falls back to `auto`.

**Resuming a parked question:** run `ask` again with the **same `--history`**. Provide the answer with `--answer "<text>"`, or simply pass it as the next `<question>` (when a pending question exists and no `--answer` is given, the question is treated as the answer). The answer is fed back to the waiting tool call — for `askUser` it becomes the tool result; for a permission it decides allow/deny, and on allow the original command runs — and the agent loop continues. If the agent parks again (a further question), the cycle repeats.

#### Example

Basic question:

```bash
aux4 ai agent ask --config --question "What's the capital of France? Just output the name of the city, nothing else."
```

```text
Paris
```

Streaming output:

```bash
aux4 ai agent ask --config --stream true --question "Explain what AI agents are in two sentences."
```

Tokens are printed to stdout as they arrive from the LLM.

With an image:

```bash
aux4 ai agent ask "Can you see geometric shapes in this image? Answer only yes or no." --image shapes.png --config
```

```text
yes
```

With piped context:

```bash
cat report.txt | aux4 ai agent ask --context true "Summarize the key findings"
```

With permissions (block file writes, allow everything else):

```bash
aux4 ai agent ask "Create a file called output.txt" --config --permissions '{"allow":["*","file:read:*"],"ask":[],"deny":["file:write:*"]}'
```

```text
Permission denied: write "output.txt" is not allowed by the permissions configuration.
```

With a policy guardrail (cap the run and forbid destructive commands):

```bash
aux4 ai agent ask "Clean up the open issues" --config \
  --policy '{"allow":[{"executeAux4":["github *"]}],"deny":[{"executeAux4":["* delete *"]}],"budget":{"tokens":50000}}'
```

If the agent attempts a denied or over-budget action, it receives a `⛔ policy ...` result and adapts.

With a loop budget (cap iterations, tokens, and wall-clock time):

```bash
aux4 ai agent ask --config \
  --budget '{"maxIterations":100,"maxTokens":200000,"maxTimeMs":600000}' \
  "Research this topic thoroughly and summarize"
```

If the loop hits a limit, the answer is a budget-exceeded note and the command exits with code 7:

```text
[budget-exceeded] Loop budget exceeded: maximum tool-loop iterations reached (limit 100). The task was stopped before completion to prevent a runaway tool loop. The agent was about to call: executeAux4.
```

With a shared history under concurrent access. A second run on a locked history fails fast:

```bash
aux4 ai agent ask --history session.json "another question"
```

```text
Error: history in use by pid 4821 since 2026-07-06T14:03:11.204Z (session.json.lock). Wait with --waitLock <duration> or steal a dead lock by removing the file.
```

Wait up to 30 seconds for the lock to free instead of failing immediately:

```bash
aux4 ai agent ask --history session.json --waitLock 30s "another question"
```

With an agent identity (`--bio`):

```bash
aux4 ai agent ask --config \
  --bio '{"name":"Ada","role":"release manager","description":"Owns the CI/CD pipeline and cuts releases"}' \
  "Who are you and what do you do?"
```

```text
I'm Ada, the release manager. I own the CI/CD pipeline and cut releases.
```

With base instructions layered before the task instructions:

```bash
aux4 ai agent ask --config \
  --baseInstructions base-policy.md \
  --instructions task.md \
  "Refactor the build script"
```

The contents of `base-policy.md` are loaded as the immutable base layer, then `task.md` is layered on top.

Human-in-the-loop, no TTY (park then resume):

```bash
# First run: the agent needs a decision but there is no TTY, so it parks and exits 10.
aux4 ai agent ask --config --history session.json "Deploy the app to the right environment"
```

```text
⏸ Paused: waiting for the user to answer a pending question. Run the agent again with the answer to continue.
```

A structured marker is emitted to stderr for a supervisor:

```text
AUX4_PENDING_QUESTION {"type":"pending_question","kind":"question","tool":"askUser","question":"Which environment — staging or production?","key":"ask:Which environment — staging or production?","timestamp":1720000000000}
```

```bash
# Resume with the answer against the same history; the loop continues from where it parked.
aux4 ai agent ask --config --history session.json --answer "staging" ""
```

With a named model from registry:

```bash
aux4 ai agent ask --configFile config.yaml --config agent --useModel fast "What is 2+2?"
```

With Codex (ChatGPT subscription, no API key needed):

```bash
aux4 ai agent ask --model '{"api":"codex","config":{"model":"gpt-5.3-codex"}}' "What time is it?"
```
