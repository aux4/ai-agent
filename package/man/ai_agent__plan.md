#### Description

Run exactly **one** LLM turn and return a structured decision, without executing any tools and without recursing. This splits the agent's "decide" step from the "act" step so an external orchestrator (for example a Step Functions state machine) can run the tools between turns and resume the agent later — even in a fresh process, loaded from the `--history` checkpoint.

`plan` loads conversation state from `--history` (plus an optional new user message passed as the positional `question`), runs a single turn, and emits a JSON result to stdout:

- `{"status":"final","text":"..."}` — the model returned a final answer with no tool calls.
- `{"status":"tool_calls","toolCalls":[{"id":"...","name":"...","arguments":{...}}]}` — the model wants tools run.

In the tool-call case, `plan` checkpoints the assistant tool-call message into the `--history` file and stops. It does **not** execute the tools and does **not** recurse. The orchestrator runs the returned `toolCalls` externally and feeds the results back with `resume`.

`plan` reuses all of `ask`'s machinery — model/provider resolution (including Bedrock/OpenAI/AWS SigV4 endpoints), tool-schema building, instructions/bio/skills, permissions, and `--history` load/save — so a plan turn behaves exactly like one turn of `ask`, minus tool execution and recursion. Structured output (`--outputSchema`) and streaming are not applied in plan mode; the JSON envelope above is the output.

Key features:

- **Decide, don't act** — returns the tool calls the model wants instead of running them
- **Resumable** — the assistant message (final or tool_calls) is checkpointed into `--history`, so a fresh process can continue
- **Same setup as `ask`** — instructions, bio, skills, permissions, model selection, tool allow-list (`--tools`) all apply
- **Optional new message** — pass a `question` to add a user turn, or omit it to continue from history alone

#### Usage

```bash
aux4 ai agent plan [--instructions <file>] [--history <file>] [--tools <names>] [--bio <json>] [--permissions <json>] [--models <json>] [--useModel <name>] [--model <json>] [<question>]
```

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

The loop an orchestrator runs is: `plan` → (execute the returned `toolCalls` externally) → `resume --toolResults <results>` → `plan` continues → … until `status` is `final`.

#### Example

Plan a turn for a question that needs a tool:

```bash
aux4 ai agent plan --configFile config.yaml --config agent \
  --instructions AGENTS.md --history history.json \
  --tools currentDateTime "What is today's date? Use the currentDateTime tool."
```

```text
{"status":"tool_calls","toolCalls":[{"id":"61086967-58e5-48c1-b7cc-575d67362f14","name":"currentDateTime","arguments":{}}]}
```

The `history.json` file now contains the user message and the assistant tool-call message, but **no** tool result — the tool was not executed. Feed a result back with `aux4 ai agent resume`.

When the model has enough to answer, `plan` returns a final result instead:

```bash
aux4 ai agent plan --configFile config.yaml --config agent --history history.json "Thanks, that's all"
```

```text
{"status":"final","text":"You're welcome!"}
```
