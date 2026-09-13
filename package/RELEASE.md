# Release notes

## 1.3.2

- History checkpoints now create their parent directory before the synchronous
  write. Fresh serverless agent executions can persist their first turn instead
  of swallowing an `ENOENT` and resuming without the question or tool-call context.

## 1.3.1

- Added `ai agent run-tool`, a single-tool execution primitive for durable
  orchestrators. It uses the normal ai-agent tool registry and permission checks,
  avoiding a second cloud-only tool implementation.

## A permission denial now says what you may run instead

`Permission denied: command "aux4 calendar next" is not allowed by the permissions configuration.`
told a caller the door was shut, not that another was open — so an agent that reached for a
plausible-but-unpermitted command concluded the task was impossible and stopped, even when
everything it needed was allowed. The denial now names the allow-list:

```
Permission denied: command "aux4 calendar next" is not allowed ... Commands you may run:
aux4 google calendar events list, aux4 google gmail send. Use one of these instead — the task
is not necessarily impossible.
```

Only the allow list is shown (deny rules stay private); `cmd`/`cmd *` pairs collapse to one entry
and the list is capped. Agents with no allow-list configured see the message unchanged.

## Recover from a stalled model, and stop runaway loops

Two robustness fixes for weaker or metered models:

- **Empty completions no longer end the run.** When a model returns nothing with no tool call, the
  agent nudges it once ("say what state you are in and take the next action") and retries, up to
  three times, before giving up. A local 4-bit model that intermittently returns empty now
  completes tasks it used to abandon.
- **Repeated identical tool calls are capped.** A tool called with the same arguments past a small
  limit is refused, and a run that keeps refusing aborts — so a loop cannot run a metered endpoint
  up to its wall-clock timeout (one such run reached 26M input tokens before this).

## executeAux4 takes the full command, and only runs aux4

`executeAux4` now receives the command exactly as typed in a terminal (`aux4 google gmail list`),
matching the man pages and the model's pretraining, which removes the "did I already say aux4?"
ambiguity that made models drop or double the prefix. It runs aux4 commands only.

## Tool detail moved behind `readReference`

Binding every tool sent every tool's full description on each request; on a small model that
context floor alone could stop it calling tools at all. The detail now lives behind a
`readReference` tool the agent consults when it needs it, keeping the per-request tool surface
small.

## Gemini CLI (OAuth) provider, and Gemini/Imagen image generation

A `gemini-cli` provider authenticates with Gemini CLI OAuth (run `gemini` once, or set
`GEMINI_CLI_REFRESH_TOKEN`), and image generation gains Gemini/Imagen alongside the OpenAI path.

## Skills are a tool, not a preamble

Installed aux4 skills were advertised by injecting a catalog into every agent's system prompt,
with an instruction to check for a matching skill "before running anything else". On a one-command
task that is wrong: a task to open a browser went hunting for the web skill, tried `aux4 web
navigate`, and never ran the command. Removing the injection took that task from 0/3 back to 3/3.

Discovery now belongs to a tool, bound only by the agents that want it:

```
aux4Skill()              -> the installed skills, as an index
aux4Skill(skill: "web")  -> that skill's full instructions
```

Agents that bind it fetch a skill when the task calls for one and pay nothing when it does not.
The no-argument response says plainly that it is an index and the skill still has to be read —
listing was being mistaken for having consulted it.

## `searchText` — find the part of a file you need

A truncated result names the file its full output was written to, but reading it back meant
paging through the whole thing. `searchText` ranks passages inside a single file and returns them
with line numbers, so a caller can ask for the section that matters:

```bash
searchText(file: "/tmp/aux4-exec-…​.stdout", query: "open a new browser session")
# [line 33]
#   open
#   Open a new browser session.
```

Indexing happens per call on one file — there is no corpus to build or keep fresh.

## Truncated output keeps its head

Output above the limit was truncated to its **last** 10KB. That is right for a log and wrong for
the most common case: `<command> --help`, where the command list is at the top. A 12.8KB help page
came back as trailing flag defaults with the subcommands deleted, so an agent asking the correct
question could not find the command it needed.

Truncation now keeps 60% head + 40% tail with the omitted byte count in between, and the notice
points at the tools that can read the rest:

```
[...2806 bytes omitted...]
[Output truncated: 12806 bytes total. The full output is at /tmp/… -- use searchText on that
 file to find the part you need, or readFile with an offset.]
```

## Image generation: default is now `gpt-image-1`

The OpenAI default was `dall-e-3`, and image generation failed outright with
`400 Unknown parameter: 'response_format'` — the parameter DALL·E accepted and the newer models
reject.

**This changes cost.** `gpt-image-1` is priced differently from `dall-e-3` and supports only
`1024x1024` among the old sizes. Pass `--model` to pick another, including the cheaper
`gpt-image-1-mini`:

```bash
aux4 ai agent image --prompt "…" --image out.png \
  --model '{"type":"openai","config":{"model":"gpt-image-1-mini"}}'
```

### Notes

- `searchText` ranks by word overlap; a few plain words work better than a sentence.
- The head/tail split and the 10KB limit are not configurable yet.
