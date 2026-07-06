# escalation shell-safety (HARN-015)

Regression test for the injection-class bug where context values injected into a
policy escalate command (`${reason}`, `${json}`, `${action}`, ...) were
shell-interpreted. Escalations previously ran through `sh -c` with the values
spliced into the command string, so backticks, `$( )`, `;`, `&&`, `|`, quotes and
newlines inside a value were command-substituted or word-split before aux4 saw
them — the same class fixed for `executeAux4` in AGC-016.

Escalation now builds an argv with `buildEscalationArgv` (tokenize the command
template, then substitute `${var}` into each argv token) and spawns `aux4`
directly, with no shell. An injected value always lands as a single literal argv
element, and there is no `sh -c` fallback.

This test runs a check script that exercises the exact code the escalation path
uses and verifies a value carrying backticks, `$( )`, `;`, `&&`, `|`, quotes and
newlines round-trips verbatim through a real `aux4 kb add`. It needs no API key.

## injected escalation values are not executed

### should deliver ${reason}/${json} as literal argv and store them verbatim

```execute
node escalation-shell-safety-check.mjs
```

```expect:partial
ESCALATION-SHELL-SAFETY OK
```
