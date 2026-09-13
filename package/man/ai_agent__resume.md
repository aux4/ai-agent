#### Description

Resume a plan/act loop: inject externally-produced tool results into the conversation, then run exactly **one** LLM turn and return the same structured decision `plan` returns. `resume` is the companion to `aux4 ai agent plan` — where `plan` decides which tools to run, `resume` feeds the results of that external execution back in and produces the next decision.

`resume` loads conversation state from `--history` (which must contain a pending assistant tool-call message checkpointed by a previous `plan`), appends the supplied tool results as correctly-paired tool messages — matched by `tool_call` id, in the provider's expected format — then performs one plan turn and emits:

- `{"status":"final","text":"..."}` — the model produced a final answer.
- `{"status":"tool_calls","toolCalls":[{"id":"...","name":"...","arguments":{...}}]}` — the model wants more tools run.

Tool results are supplied with `--toolResults`, as either a path to a JSON file or an inline JSON string, shaped as an array of `{"id":"<toolCallId>","content":"<result>"}`. Each `id` must match a `tool_call` id from the pending assistant message; the tool name is resolved automatically from that message. An optional positional `question` adds a new user message for this turn.

Under the hood, resume is simply `plan` preceded by injecting the tool results — it is the same single-turn primitive, reusing all of `ask`'s setup (model/provider resolution, tool-schema building, instructions/bio/skills, permissions, `--history` load/save). Like `plan`, it does not execute tools itself and does not recurse.

#### Usage

```bash
aux4 ai agent resume --toolResults <file-or-json> [--instructions <file>] [--history <file>] [--tools <names>] [--bio <json>] [--permissions <json>] [--models <json>] [--useModel <name>] [--model <json>] [<question>]
```

--toolResults    Tool results as a JSON file path or inline JSON array of `{id, content}` matching the pending tool_call ids (default: "")
--baseInstructions  Base instructions file loaded before the main instructions (default: "")
--instructions   Prompt instructions file (default: AGENTS.md; falls back to AGENT.md then instructions.md)
--history        History JSON file — loaded and checkpointed (default: "")
--tools          Optional comma-separated allow-list of tool names to bind (default: all tools)
--bio            Agent identity as a JSON object with name, role, description (default: "")
--permissions    Permissions config as JSON with allow, ask, deny arrays (default: {})
--models         Models registry as JSON (default: {})
--useModel       Named model from registry to use for this request (default: "")
--model          Inline model configuration as JSON (default: {})
question         Optional new user message for this turn (positional argument)

#### Example

Given a `history.json` left by a previous `plan` with a pending `currentDateTime` tool call, feed the tool result back:

```bash
aux4 ai agent resume --configFile config.yaml --config agent \
  --instructions AGENTS.md --history history.json --tools currentDateTime \
  --toolResults '[{"id":"61086967-58e5-48c1-b7cc-575d67362f14","content":"Local: Friday, January 1, 2099 12:00:00 PM UTC\nUTC: 2099-01-01T12:00:00.000Z"}]'
```

```text
{"status":"final","text":"2099-01-01"}
```

The final answer is drawn from the injected tool result, confirming the agent used the externally-supplied value rather than executing the tool itself. If the model needs another tool, `resume` returns a `tool_calls` result and the orchestrator loops back to executing tools and calling `resume` again.
