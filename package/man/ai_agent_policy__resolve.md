#### Description

Resolve a parked (block-mode) policy escalation. When a policy `escalate` rule with `mode: block` fires during an agent run, the run parks and waits for a decision. A human — or an automated approver agent — answers it with this command, identifying the escalation by the id that was injected into the escalate command as `${escalationId}`.

Decisions:

- `allow_once` — let the parked action proceed this once
- `widen` — proceed (the operator has widened the policy out-of-band)
- `stop` — keep the action denied

An unanswered block escalation stays parked (fail closed), so the run never exceeds its bounds while waiting. Escalations are stored per user under `~/.aux4.config/ai-agent/escalations/`, so the resolving session does not need to be the same process as the parked run.

#### Usage

```bash
aux4 ai agent policy resolve <escalationId> --decision <allow_once|widen|stop>
```

escalationId   The escalation id to resolve (positional argument)
--decision     The decision: allow_once, widen, or stop (required)

#### Example

```bash
aux4 ai agent policy resolve esc_7fb2336a666e --decision allow_once
```

```json
{"escalationId":"esc_7fb2336a666e","state":"resolved","decision":"allow_once"}
```
