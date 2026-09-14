# ai agent run-tools-and-resume

Executes one or more tool calls through the standard aux4 AI Agent tool registry, injects their results into the durable history, and runs exactly one resumed planning turn. The tool registry is discovered once and all calls execute in parallel.

This is an opt-in latency primitive for durable orchestrators whose tools are expected to finish within one Lambda invocation. Use the separate `run-tool` and `resume` commands when a tool must suspend independently or may outlive the function timeout.

An optional `--historySeed` carries the exact checkpoint produced by an earlier planning turn. It is written only when `--history` does not already exist, so a retry or later loop cannot replace newer durable state.

## Usage

````text
aux4 ai agent run-tools-and-resume '<toolCalls JSON>' --history <file> [options]
````

## Options

- `--toolCalls` — one tool-call object or an array, inline JSON or a JSON file path.
- `--history` — durable session history file.
- `--historySeed` — optional initial history checkpoint JSON.
- `--model`, `--instructions`, `--tools`, `--permissions` — the same model and agent configuration accepted by `resume`.

## Example

````bash
aux4 ai agent run-tools-and-resume \
  '[{"id":"t1","name":"currentDateTime","arguments":{}}]' \
  --history .agent/history.json \
  --historySeed '{"messages":[{"role":"user","content":"What time is it?"}]}'
````
