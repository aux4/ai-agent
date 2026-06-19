#### Description

Dry-run a policy decision for a single tool/action without running the tool or calling an LLM. It loads the policy exactly as the agent would (including hash-pin verification for referenced files and narrowing composition for layered files) and prints the decision as compact JSON. Use it to verify what a policy will permit before handing it to an agent, or in tests.

Escalation rules are **not** fired by this command — it is a pure decision check.

The decision is computed against:

- **the tool** (`--tool`) — only consequential tools (`executeAux4`, `writeFile`, `editFile`, `removeFiles`, `createDirectory`, `saveImage`) are gated; read-only tools always return `allow` with reason `read-only tool (exempt)`
- **the action** — the aux4 command string for `executeAux4`, or the file/directory path for the file tools
- **a usage/spend snapshot** (`--usage`, `--calls`) — to test budget caps

The output includes `decision` (`allow`/`deny`), `reason`, an optional `trigger` (`denied_action`, `budget_exceeded`, or `hash_mismatch`), and the `spend` snapshot.

#### Usage

```bash
aux4 ai agent policy check <action> --tool <toolName> [--policy <path|json>] [--usage <json>] [--calls <n>]
```

--tool     The tool name to check (e.g. executeAux4, writeFile, removeFiles) (required)
--policy   Policy file path (comma-separated for layers) or inline JSON object (default: "")
--usage    Token usage snapshot as JSON: input, output, cached, total (default: {})
--calls    Consequential tool call count so far (default: 0)
action     The action subject: a command for executeAux4, or a file path for file tools (positional argument)

#### Example

Check a command against a deny rule:

```bash
aux4 ai agent policy check "db delete users" --tool executeAux4 \
  --policy '{"deny":[{"executeAux4":["* delete *"]}]}'
```

```json
{"tool":"executeAux4","action":"db delete users","decision":"deny","reason":"policy denies executeAux4 \"db delete users\"","trigger":"denied_action","spend":{"tokens":0,"usd":0,"calls":0}}
```

Check a budget cap:

```bash
aux4 ai agent policy check "out.txt" --tool writeFile \
  --policy '{"budget":{"tokens":100}}' --usage '{"total":500}'
```

```json
{"tool":"writeFile","action":"out.txt","decision":"deny","reason":"budget exceeded (spent 500 tokens / 0 calls / $0.0000, cap 100 tokens)","trigger":"budget_exceeded","spend":{"tokens":500,"usd":0,"calls":0}}
```

Check a hash-pinned policy file (denies everything if the pin is missing or wrong):

```bash
aux4 ai agent policy check "out.txt" --tool writeFile --policy triage.policy.yaml
```

```json
{"tool":"writeFile","action":"out.txt","decision":"deny","reason":"no approved hash pin for policy \"triage.policy.yaml\" (expected triage.policy.yaml.sha256)","trigger":"hash_mismatch","spend":{"tokens":0,"usd":0,"calls":0}}
```
