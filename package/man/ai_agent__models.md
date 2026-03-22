#### Description

List the named models available in the models registry. Each entry shows the model name, provider type, model ID, and description.

The models registry is defined in `config.yaml` under `config.agent.models` (or whichever config section the agent uses). It provides named aliases that can be referenced with `--useModel` on commands like `ask`, `chat`, `summarize`, `remember`, and `compact`.

#### Usage

```bash
aux4 ai agent models [--models <json>]
```

--models   Models registry as JSON (default: {})

When used with `--configFile` and `--config`, the registry is loaded from the config file automatically.

#### Example

List models from a config file:

```bash
aux4 ai agent models --configFile config.yaml --config agent
```

```text
  strong  bedrock  global.anthropic.claude-sonnet-4-5-20250929-v1:0  Complex reasoning, code generation, multi-step analysis
  fast    bedrock  global.anthropic.claude-haiku-4-5-20251001-v1:0   Simple questions, factual lookups, formatting, routine tasks
```

List models inline:

```bash
aux4 ai agent models --models '{"fast":{"type":"openai","config":{"model":"gpt-4o-mini"},"description":"Simple tasks"}}'
```

```text
  fast  openai  gpt-4o-mini  Simple tasks
```
