# policy

Deterministic checks of the policy guardrail engine via `aux4 ai agent policy check`
and `aux4 ai agent policy resolve`. These do not call an LLM — they exercise the
decision logic directly.

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

### should deny a write outside the allowed path

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

## narrowing merge (layered policies)

### should enforce the tighter budget (min) when layers compose

```execute
aux4 ai agent policy check "out.txt" --tool writeFile --policy '[{"budget":{"tokens":1000}},{"budget":{"tokens":200}}]' --usage '{"total":300}'
```

```expect:partial
"decision":"deny"*"trigger":"budget_exceeded"
```

### should keep a deny added by a lower layer (deny union)

```execute
aux4 ai agent policy check "rm -rf /" --tool executeAux4 --policy '[{"deny":[{"executeAux4":["db *"]}]},{"deny":[{"executeAux4":["rm *"]}]}]'
```

```expect:partial
"decision":"deny"*"trigger":"denied_action"
```

### should remove capability dropped by a lower layer (allow intersection)

```execute
aux4 ai agent policy check "email send x" --tool executeAux4 --policy '[{"allow":[{"executeAux4":["github *","email *"]}]},{"allow":[{"executeAux4":["github *"]}]}]'
```

```expect:partial
"decision":"deny"
```

## hash-pinned policy files (immutability, fail closed)

```beforeAll
mkdir -p policy-fixtures
printf 'config:\n  deny:\n    - executeAux4: ["* delete *"]\n' > policy-fixtures/test.policy.yaml
```

```afterAll
rm -rf policy-fixtures
```

### should deny everything when no hash pin exists

```execute
aux4 ai agent policy check "out.txt" --tool writeFile --policy policy-fixtures/test.policy.yaml
```

```expect:partial
"decision":"deny"*"trigger":"hash_mismatch"
```

### should deny everything when the hash pin does not match

```beforeEach
echo "deadbeef" > policy-fixtures/test.policy.yaml.sha256
```

```execute
aux4 ai agent policy check "out.txt" --tool writeFile --policy policy-fixtures/test.policy.yaml
```

```expect:partial
"decision":"deny"*"trigger":"hash_mismatch"
```

### should enforce normally when the hash pin matches

```beforeEach
shasum -a 256 policy-fixtures/test.policy.yaml | awk '{print $1}' > policy-fixtures/test.policy.yaml.sha256
```

```execute
aux4 ai agent policy check "github list" --tool executeAux4 --policy policy-fixtures/test.policy.yaml
```

```expect:partial
"decision":"allow"
```

### should still apply the deny from a correctly pinned file

```beforeEach
shasum -a 256 policy-fixtures/test.policy.yaml | awk '{print $1}' > policy-fixtures/test.policy.yaml.sha256
```

```execute
aux4 ai agent policy check "db delete x" --tool executeAux4 --policy policy-fixtures/test.policy.yaml
```

```expect:partial
"decision":"deny"*"trigger":"denied_action"
```

## escalation resolve

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
