# Release notes

## MCP support restored — `mcp.json` tools are bound alongside `executeAux4` again

1.3.20 dropped `mcp.json` / MCP server support while switching built-ins to tool-dispatched
commands (`aux4 ai agent tool <name>`); `--tools` on `ask` also became a silent no-op. Both are
restored:

- An `mcp.json` file in the working directory (`{"mcpServers": {"<name>": {"command": ...,
  "args": [...]}}}`) is loaded again, and each configured server's tools are bound to the model
  alongside `executeAux4` — for **every** `api` type, including `api: chatgpt` (MCP tools pass
  through `ResponsesApi#bindTools`, so the same description-length/schema cleanup applies). MCP
  clients are closed on exit.
- MCP tool calls now go through the same permission and policy checks as the built-ins (they did
  not before 1.3.20 either): the subject is `mcp:<toolName>`, independent of `executeAux4`'s own
  `aux4 <command>` subjects. With no matching pattern the default allow (`["*"]`) applies, so an
  unconfigured `mcp.json` behaves exactly as it did before permission checking existed for MCP
  tools.
- `--tools` is a real allow-list again: a comma-separated list of tool names (`executeAux4` plus
  any MCP tools) to bind; unlisted tools are not exposed to the model at all. Unknown names are a
  clear error listing the valid names for that run, instead of a silent no-op.

See the MCP Servers section in the README and `aux4 aux4 man ai_agent__ask`.

## Codex provider removed — `api: codex` is now a deprecated alias for `api: chatgpt`

The separate Codex OAuth path (the `codex`-CLI-dependent provider reading `~/.codex/auth.json`)
has been removed. `api: codex` still works in existing configs: it now routes through the same
Sign in with ChatGPT path as `api: chatgpt` and prints one deprecation warning to stderr —
`api: codex is deprecated; use api: chatgpt — sign in with` `aux4 ai agent auth login`. The
configured model is passed through unchanged; if it's a Codex-only model id the ChatGPT API
doesn't serve, the API's own error surfaces rather than being silently rewritten. Update configs
to `api: chatgpt` and run `aux4 ai agent auth login` when convenient.

## Sign in with ChatGPT — use your ChatGPT plan without an API key

`aux4 ai agent auth login` signs in with the same "Sign in with ChatGPT" OAuth flow used by
OpenAI's own tools (PKCE, a loopback callback on `127.0.0.1`, ID-token signature verification).
Credentials are saved under `~/.config/aux4-ai-agent/` with `0600`/`0700` permissions and
refreshed automatically. Once signed in:

```bash
aux4 ai agent auth models   # list models available to your plan
aux4 ai agent auth status   # check who is signed in
aux4 ai agent auth logout   # revoke and sign out
```

Set `api: chatgpt` and a model from `auth models` to use it:

```yaml
config:
  agent:
    model:
      api: chatgpt
      config:
        model: gpt-6.1-sol
```

Requests go to `https://api.openai.com/v1/responses` with `store:false`, streamed, authenticated
with the signed-in bearer token. `api: codex` is a deprecated alias that now routes through this
same path (see above) — `api: chatgpt` is the recommended, self-contained way to use ChatGPT plan
credits.

## Built-in tools are now dispatched as `aux4 ai agent tool` commands

The model's only bindable tool is `executeAux4`. File, search, reference, skill, and
user-interaction operations that used to be separate model-visible tools (`readFile`, `writeFile`,
`searchFiles`, `askUser`, etc.) are now `aux4 ai agent tool <name>` CLI commands — discoverable
with `aux4 ai agent tool --help` — invoked through `executeAux4` like any other aux4 command. This
keeps every tool call going through the same permission/guardrail path as other aux4 commands, and
shrinks the per-request tool schema the model sees to one entry. Behavior and permission checks
for each operation are unchanged; only how the model invokes them changed. The `--tools` flag on
`aux4 ai agent ask` is now a deprecated no-op (only `executeAux4` is ever bound).

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
