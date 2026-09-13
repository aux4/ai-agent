#### Description

Executes one model-produced tool call through the same registry used by
`ai agent ask` and `ai agent plan`. The command validates the tool's arguments,
applies the configured permission rules, invokes it, and emits one JSON result:

```json
{"id":"call-1","content":"tool output"}
```

This primitive is intended for durable orchestrators that sequence
`plan` → `run-tool` → `resume`. The tool call may be supplied as inline JSON or
as the path to a JSON file. Tool exceptions are returned as an `Error: ...`
result for the next planning turn instead of terminating the workflow.

#### Usage

```bash
aux4 ai agent run-tool '<tool-call-json>' [options]
```

Options:

- `--permissions <json>` — command permission allow/ask/deny rules.
- `--tools <names>` — comma-separated tool allow-list.
- `--storage <path>` — context storage directory.
- `--references <path>` — references directory.
- `--skills <path>` — skills directory.

#### Example

```bash
aux4 ai agent run-tool \
  '{"id":"clock-1","name":"currentDateTime","arguments":{}}'
```
