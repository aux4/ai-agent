# policy

Deterministic checks of the policy guardrail engine via `aux4 ai agent policy check`
and `aux4 ai agent policy resolve`. These do not call an LLM — they exercise the
decision logic directly. The `--policy` value is an inline policy object passed as a
JSON string.

## inline policy decisions

### should allow a consequential tool that matches the allow-list

```execute
aux4 ai agent policy check "github issue list" --tool executeAux4 --policy '{"allow":[{"executeAux4":["github *"]}]}'
```

```expect:partial
"decision":"allow"
```

### should deny a command outside the allow-list (allow narrows)

```execute
aux4 ai agent policy check "email send hi" --tool executeAux4 --policy '{"allow":[{"executeAux4":["github *"]}]}'
```

```expect:partial
"decision":"deny"*"trigger":"denied_action"
```

### should deny a command that matches a deny pattern

```execute
aux4 ai agent policy check "db delete users" --tool executeAux4 --policy '{"deny":[{"executeAux4":["* delete *"]}]}'
```

```expect:partial
"decision":"deny"*"trigger":"denied_action"
```

### should exempt read-only tools from policy enforcement

```execute
aux4 ai agent policy check "secret.txt" --tool readFile --policy '{"deny":[{"readFile":["*"]}]}'
```

```expect:partial
"decision":"allow"*"read-only tool (exempt)"
```

### should deny a write outside the allowed path (permission narrowing)

```execute
aux4 ai agent policy check "/etc/passwd" --tool writeFile --policy '{"allow":[{"writeFile":["digest/*"]}]}'
```

```expect:partial
"decision":"deny"
```

### should allow a write inside the allowed path

```execute
aux4 ai agent policy check "digest/report.md" --tool writeFile --policy '{"allow":[{"writeFile":["digest/*"]}]}'
```

```expect:partial
"decision":"allow"
```

## budget enforcement

### should deny when the token budget is exceeded

```execute
aux4 ai agent policy check "out.txt" --tool writeFile --policy '{"budget":{"tokens":100}}' --usage '{"total":500}'
```

```expect:partial
"decision":"deny"*"trigger":"budget_exceeded"
```

### should deny when the call budget is exceeded

```execute
aux4 ai agent policy check "out.txt" --tool writeFile --policy '{"budget":{"calls":3}}' --calls 5
```

```expect:partial
"decision":"deny"*"trigger":"budget_exceeded"
```

### should allow when usage is under the budget

```execute
aux4 ai agent policy check "out.txt" --tool writeFile --policy '{"budget":{"tokens":1000}}' --usage '{"total":200}'
```

```expect:partial
"decision":"allow"
```

### should deny when the usd budget is exceeded using --costs rates

```execute
aux4 ai agent policy check "out.txt" --tool writeFile --policy '{"budget":{"usd":0.01}}' --usage '{"input":1000000,"output":1000000,"total":2000000}' --costs '{"costIn":1,"costOut":1}'
```

```expect:partial
"decision":"deny"*"trigger":"budget_exceeded"
```

## runId auto-generation

### should auto-generate a non-empty runId when none is provided

```execute
aux4 ai agent policy check "github list" --tool executeAux4 --policy '{"allow":[{"executeAux4":["github *"]}]}'
```

```expect:partial
"runId":"run_*"
```

### should populate runId in an escalated (notify) decision when no runId is passed

```execute
aux4 ai agent policy check "db delete users" --tool executeAux4 --policy '{"deny":[{"executeAux4":["* delete *"]}],"escalate":[{"on":["denied_action"],"mode":"notify"}]}'
```

```expect:partial
"decision":"escalate"*"runId":"run_*"
```

### should keep an explicitly provided runId

```execute
aux4 ai agent policy check "github list" --tool executeAux4 --policy '{"allow":[{"executeAux4":["github *"]}]}' --runId my-run-123
```

```expect:partial
"runId":"my-run-123"
```

## escalation

### should escalate a denied action via a notify rule

```execute
aux4 ai agent policy check "db delete users" --tool executeAux4 --policy '{"deny":[{"executeAux4":["* delete *"]}],"escalate":[{"on":["denied_action"],"mode":"notify"}]}'
```

```expect:partial
"decision":"escalate"*"escalationId":"esc_*"
```

### should resolve a parked escalation with allow_once

```execute
aux4 ai agent policy resolve esc_resolvetest --decision allow_once
```

```expect:partial
"escalationId":"esc_resolvetest"*"state":"resolved"*"decision":"allow_once"
```

### should reject an invalid decision

```execute
aux4 ai agent policy resolve esc_resolvetest --decision maybe
```

```error:partial
*invalid decision*
```
