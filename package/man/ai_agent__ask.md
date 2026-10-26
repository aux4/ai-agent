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
- **askUser tool** — when the agent needs clarification it can prompt the user interactively; in non-interactive sessions it proceeds with best judgment
- **Permissions** — control which aux4 commands and file operations the agent can perform using allow/ask/deny pattern lists
- **Policy guardrails** — an optional, enforced, swappable layer on top of permissions: per-run token/cost/call budgets, narrowing allow/deny rules, and escalation triggers (see `--policy`)
- **Model selection** — choose a named model from a registry with `--useModel` instead of passing inline model JSON
- **Codex** — set `api: codex` in the model config to use OpenAI models with your ChatGPT subscription via `~/.codex/auth.json`
- **Tool-call hooks** — check or stub any tool call before it runs with `--hooks <file>`, following aux4 core's own hook standard (see below)
- **searchContext embeddings** — the `searchContext` tool (document retrieval against `--storage`) uses `--embeddings` to pick its embeddings provider/config; default type is `local` (offline, no API key). Must match what `--storage` was learned with

#### Usage

```bash
aux4 ai agent ask [--baseInstructions <file>] [--instructions <file>] [--bio <json>] [--role <role>] [--history <file>] [--outputSchema <file>] [--context <true|false>] [--image <paths>] [--storage <dir>] [--stream <true|false>] [--autoCompact <true|false>] [--compaction <json>] [--permissions <json>] [--policy <json>] [--runId <id>] [--costs <json>] [--embeddings <json>] [--models <json>] [--useModel <name>] [--references <dir>] [--skills <dir>] [--hooks <file>] <question>
```

--baseInstructions  Base instructions file loaded before the main instructions — an immutable base-prompt layer (default: "")
--instructions   Prompt instructions file (default: AGENTS.md; falls back to AGENT.md then instructions.md if not found)
--bio            Agent identity as a JSON object with name, role, description — rendered as a `# Agent Identity` system section (default: "")
--role           Role used in the prompt (default: user)
--history        History JSON file for multi-turn conversations (default: "")
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
--embeddings     Embeddings configuration as JSON for the searchContext tool, `{"type": "...", "config": {...}}` (default: {}, which resolves to type local). Must match what --storage was learned with
--models         Models registry as JSON (default: {})
--useModel       Named model from registry to use for this request; falls back to default model if name is not found (default: "")
--references     Path to the references directory (default: ${packageDir}/references)
--skills         Path to the skills directory (default: .agents/skills)
--hooks          Path to a hooks file (default: "") -- see "Tool-call hooks" below
question         The question to ask (positional argument)

Permissions control which aux4 commands and file operations the agent can perform. Patterns are evaluated in order: deny, ask, allow. Command patterns match tool executions (e.g., `hello`, `deploy*`). File patterns use the format `file:<scope>:<glob>` where scope is `read`, `write`, or `delete` (e.g., `file:write:*.env`, `file:read:*`). See the Permissions section in the README for full details.

Policy guardrails (`--policy`) add an optional, enforced layer on top of permissions. The effective permission for a tool is the static permissions **intersected** with the policy — a policy can only narrow, never grant. Only consequential tools (`executeAux4`, `writeFile`, `editFile`, `removeFiles`, `createDirectory`, `saveImage`) are gated; read-only tools are exempt. The policy is an inline object (aux4 delivers a config object as JSON automatically) and supports a per-run `budget` (`tokens`/`usd`/`calls`, read from the live token usage the run already maintains — no separate ledger), `allow`/`deny` rule lists, and `escalate` triggers (`block`/`notify` modes running any aux4 command with injected `${trigger}/${reason}/${agent}/${runId}/${action}/${spent}/${cap}/${escalationId}/${json}` variables). `${runId}` is auto-generated when `--runId` is not passed. When `--history` is set, each policy decision is recorded on the corresponding tool entry as a `policy` field. With no `--policy`, behavior is unchanged. See the Policy Guardrails section in the README, and `aux4 ai agent policy check` / `aux4 ai agent policy resolve`.

Auto-compaction requires both `--autoCompact true` and a `compaction` config with `contextWindow` set. When prompt tokens exceed the threshold (`contextWindow * maxContextPercent / 100`), older messages are automatically summarized.

Compaction config fields:
- `contextWindow` — model's context window size in tokens (required)
- `maxContextPercent` — trigger threshold as percentage (default: 85)
- `keepLastMessages` — recent messages to keep verbatim (default: 6)
- `model` — optional model config for summarization (defaults to main model)

**Agent identity (`--bio`):** Pass a JSON object describing who the agent is. The recognized fields are `name`, `role`, and `description`. When present, they are rendered as a `# Agent Identity` system section (bold `**Name:**` / `**Role:**` / `**Description:**` lines) and injected at the top of the system prompt — above the base instructions and the main instructions — so the agent consistently knows its persona. An empty or omitted `--bio` adds nothing. When stored in a config file under a top-level `bio:` key, aux4 delivers it as JSON automatically.

**Base instructions (`--baseInstructions`):** Pass a path to a file whose contents are loaded as system instructions **before** the main `--instructions` file. This is the immutable base-prompt layer: shared, always-on discipline that should not be overridden by the per-task instructions layered on top. The load order is: agent identity (`--bio`) → base instructions (`--baseInstructions`) → main instructions (`--instructions`).

**Skills directory:** When `--skills` points to a directory containing skill definitions, the agent discovers available skills at startup and can read their full instructions on demand using the `readSkill` tool. Each skill is a subdirectory with a `SKILL.md` file containing YAML frontmatter (`name`, `description`) and markdown instructions. See the Skills section in the README for the folder structure.

**Tool-call hooks (`--hooks`):** Point at a JSON file shaped `{ "hooks": [...] }` — the exact same shape as a package's own top-level `hooks` array (see `aux4 aux4 man aux4__hooks` for the core contract this follows). Each hook:

- `tool` — which tool it targets (`executeAux4`, `writeFile`, `removeFiles`, ...). Defaults to `executeAux4`.
- `command` — for `executeAux4` only: a `<profile>/<command>` pattern (e.g. `agent:browser/run`), `*` matches any single segment. Resolved from the model's command string the way aux4 itself resolves it (`aux4 <action> --whereIsIt`), never guessed from the string.
- `params` — a match filter on the call's own params (parsed the way aux4 would parse `--name value` pairs for `executeAux4`; the tool's own arguments object for every other tool). `"|"` separates alternatives; a missing param never matches; a repeated flag (e.g. two `--field` values) matches if ANY of its values match.
- `order` — lower runs first (default 0); ties broken by declaration order.
- `before` / `replace` / `after` / `error` — aux4 execute steps (run by aux4 itself; `profile:`/`stdin:` are blocked, same as core). A failing `before` step blocks the call — the model never sees it run, and gets the step's own output back as the result, prefixed `Blocked by hook: `. A `replace` hook substitutes its own output for the call entirely. `after` fires once a call succeeds, `error` once it throws; both are best-effort, except: a successful `after` step with non-empty stdout replaces the result.

Every step gets `${__tool}`, `${__command}`, `${__request}` (this round's user request), `${__history}` (the `--history` file, so a hook can read prior tool results), `${__session}`, and the call's own params, interpolated exactly like a command's own declared variables. `after`/`error` steps additionally get `${__response}` / `${__error}` / `${__exitCode}`.

With no `--hooks`, behavior is unchanged.

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

With a named model from registry:

```bash
aux4 ai agent ask --configFile config.yaml --config agent --useModel fast "What is 2+2?"
```

With Codex (ChatGPT subscription, no API key needed):

```bash
aux4 ai agent ask --model '{"api":"codex","config":{"model":"gpt-5.3-codex"}}' "What time is it?"
```

With a tool-call hook (block a browser form submission that carries a made-up value):

`hooks.json`:

```json
{
  "hooks": [
    {
      "command": "agent:browser/run",
      "params": { "field": "confirm=yes" },
      "before": [
        "aux4 agent check-values --request \"${__request}\" --history \"${__history}\""
      ]
    }
  ]
}
```

```bash
aux4 ai agent ask --config --hooks hooks.json "Submit the order with employee id 12345"
```

If `aux4 agent check-values` exits non-zero (the id was never sourced from the request or an earlier tool result), the submission never runs and the model sees the check's own message instead.
