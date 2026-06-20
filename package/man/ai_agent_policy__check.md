#### Description

Check a policy decision for a single tool/action without running the tool or calling an LLM. It loads the policy exactly as the agent would (an inline policy object) and prints the decision as compact JSON. Use it to verify what a policy will permit before handing it to an agent, or in tests.

When the resulting trigger matches an `escalate` rule, that escalation is fired (notify) so the escalation path — including `${runId}` injection — is exercised; the decision then reads `escalate`.

The decision is computed against:

- **the tool** (`--tool`) — only consequential tools (`executeAux4`, `writeFile`, `editFile`, `removeFiles`, `createDirectory`, `saveImage`) are gated; read-only tools always return `allow` with reason `read-only tool (exempt)`
- **the action** — the aux4 command string for `executeAux4`, or the file/directory path for the file tools
- **a usage/spend snapshot** (`--usage`, `--calls`, `--costs`) — to test budget caps

The output includes `decision` (`allow`/`deny`/`escalate`), `reason`, an optional `trigger` (`denied_action` or `budget_exceeded`), an optional `escalationId`, and the `runId` (auto-generated when `--runId` is not passed).

#### Usage

```bash
aux4 ai agent policy check <action> --tool <toolName> [--policy <json>] [--usage <json>] [--calls <n>] [--runId <id>] [--costs <json>]
```

--tool     The tool name to check (e.g. executeAux4, writeFile, removeFiles) (required)
--policy   Inline policy object (budget/allow/deny/escalate) delivered as JSON (default: "")
--usage    Token usage snapshot as JSON: input, output, cached, total (default: {})
--calls    Consequential tool call count so far (default: 0)
--runId    Run identifier injected into escalation commands; auto-generated when empty (default: "")
--costs    Cost rates as JSON (costIn, costOut, costCache per 1M tokens) for the usd budget (default: {})
action     The action subject: a command for executeAux4, or a file path for file tools (positional argument)

#### Example

Check a command against a deny rule:

```bash
aux4 ai agent policy check "db delete users" --tool executeAux4 \
  --policy '{"deny":[{"executeAux4":["* delete *"]}]}'
```

```json
{"tool":"executeAux4","action":"db delete users","decision":"deny","reason":"policy denies executeAux4 \"db delete users\"","trigger":"denied_action","runId":"run_lq3k8z_a1b2c3"}
```

Check a budget cap:

```bash
aux4 ai agent policy check "out.txt" --tool writeFile \
  --policy '{"budget":{"tokens":100}}' --usage '{"total":500}'
```

```json
{"tool":"writeFile","action":"out.txt","decision":"deny","reason":"budget exceeded (spent 500 tokens / 0 calls / $0.0000, cap 100 tokens)","trigger":"budget_exceeded","runId":"run_lq3k8z_a1b2c3"}
```

Check the usd budget with cost rates:

```bash
aux4 ai agent policy check "out.txt" --tool writeFile \
  --policy '{"budget":{"usd":0.01}}' \
  --usage '{"input":1000000,"output":1000000,"total":2000000}' \
  --costs '{"costIn":1,"costOut":1}'
```

```json
{"tool":"writeFile","action":"out.txt","decision":"deny","reason":"budget exceeded (spent 2000000 tokens / 0 calls / $2.0000, cap $0.01)","trigger":"budget_exceeded","runId":"run_lq3k8z_a1b2c3"}
```
