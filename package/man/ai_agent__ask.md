#### Description

Ask a single question to the AI agent. The agent composes the prompt using an instructions file, optional conversation history, optional images, and retrieves relevant documents from the local vector store when configured. The response is printed to stdout.

Key features:

- **Prompt instructions** — load a custom instructions file to shape the assistant's behavior
- **Context from stdin** — pipe additional context into the prompt with `--context true`
- **Image input** — attach one or more images for visual question answering
- **Conversation history** — maintain multi-turn conversations via a history JSON file
- **Structured output** — constrain responses to a JSON schema
- **Streaming** — print tokens as they arrive with `--stream true`
- **Built-in tools** — the agent can call tools (readFile, writeFile, editFile, searchFiles, executeAux4, askUser, etc.) during execution
- **askUser tool** — when the agent needs clarification it can prompt the user interactively; in non-interactive sessions it proceeds with best judgment
- **Permissions** — control which aux4 commands and file operations the agent can perform using allow/ask/deny pattern lists
- **Policy guardrails** — an optional, enforced, swappable layer on top of permissions: per-run token/cost/call budgets, narrowing allow/deny rules, hash-pinned immutability (fail closed), and escalation triggers (see `--policy`)
- **Model selection** — choose a named model from a registry with `--useModel` instead of passing inline model JSON
- **Codex** — set `api: codex` in the model config to use OpenAI models with your ChatGPT subscription via `~/.codex/auth.json`

#### Usage

```bash
aux4 ai agent ask [--instructions <file>] [--role <role>] [--history <file>] [--outputSchema <file>] [--context <true|false>] [--image <paths>] [--storage <dir>] [--stream <true|false>] [--autoCompact <true|false>] [--compaction <json>] [--permissions <json>] [--policy <path|json>] [--runId <id>] [--costs <json>] [--models <json>] [--useModel <name>] [--references <dir>] [--skills <dir>] <question>
```

--instructions   Prompt instructions file (default: AGENTS.md; falls back to AGENT.md then instructions.md if not found)
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
--policy         Optional guardrail policy: a path to a hash-pinned policy file (comma-separated for layered files) or an inline JSON object with budget/allow/deny/escalate (default: "")
--runId          Optional run identifier injected into escalation commands as ${runId} (default: "")
--costs          Optional cost rates as JSON (costIn, costOut, costCache per 1M tokens) used for the policy usd budget (default: {})
--models         Models registry as JSON (default: {})
--useModel       Named model from registry to use for this request; falls back to default model if name is not found (default: "")
--references     Path to the references directory (default: ${packageDir}/references)
--skills         Path to the skills directory (default: skills)
question         The question to ask (positional argument)

Permissions control which aux4 commands and file operations the agent can perform. Patterns are evaluated in order: deny, ask, allow. Command patterns match tool executions (e.g., `hello`, `deploy*`). File patterns use the format `file:<scope>:<glob>` where scope is `read`, `write`, or `delete` (e.g., `file:write:*.env`, `file:read:*`). See the Permissions section in the README for full details.

Policy guardrails (`--policy`) add an optional, enforced layer on top of permissions. The effective permission for a tool is the static permissions **intersected** with the policy — a policy can only narrow, never grant. Only consequential tools (`executeAux4`, `writeFile`, `editFile`, `removeFiles`, `createDirectory`, `saveImage`) are gated; read-only tools are exempt. The policy supports a per-run `budget` (`tokens`/`usd`/`calls`, read from the live token usage the run already maintains — no separate ledger), `allow`/`deny` rule lists, hash-pinned immutability (a referenced file is verified against an approved `<file>.sha256` pin and fails closed on mismatch), narrowing layer composition (deny=union, allow=intersection, budget=min), and `escalate` triggers (`block`/`notify` modes running any aux4 command with injected `${trigger}/${reason}/${agent}/${action}/${spent}/${cap}/${escalationId}/${json}` variables). When `--history` is set, each policy decision is recorded on the corresponding tool entry as a `policy` field. With no `--policy`, behavior is unchanged. See the Policy Guardrails section in the README, and `aux4 ai agent policy check` / `aux4 ai agent policy resolve`.

Auto-compaction requires both `--autoCompact true` and a `compaction` config with `contextWindow` set. When prompt tokens exceed the threshold (`contextWindow * maxContextPercent / 100`), older messages are automatically summarized.

Compaction config fields:
- `contextWindow` — model's context window size in tokens (required)
- `maxContextPercent` — trigger threshold as percentage (default: 85)
- `keepLastMessages` — recent messages to keep verbatim (default: 6)
- `model` — optional model config for summarization (defaults to main model)

**Skills directory:** When `--skills` points to a directory containing skill definitions, the agent discovers available skills at startup and can read their full instructions on demand using the `readSkill` tool. Each skill is a subdirectory with a `SKILL.md` file containing YAML frontmatter (`name`, `description`) and markdown instructions. See the Skills section in the README for the folder structure.

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

With a hash-pinned policy file:

```bash
shasum -a 256 triage.policy.yaml | awk '{print $1}' > triage.policy.yaml.sha256
aux4 ai agent ask "summarize the digest" --config --policy triage.policy.yaml
```

With a named model from registry:

```bash
aux4 ai agent ask --configFile config.yaml --config agent --useModel fast "What is 2+2?"
```

With Codex (ChatGPT subscription, no API key needed):

```bash
aux4 ai agent ask --model '{"api":"codex","config":{"model":"gpt-5.3-codex"}}' "What time is it?"
```
