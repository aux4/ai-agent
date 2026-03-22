#### Description

Summarize a conversation history file into a markdown document. The summary is printed to stdout, making it easy to pipe into other commands — save to a file, store in the knowledge base with `learn`, or use as input for other tools.

The summarizer skips tool call invocations and extracts only the meaningful text from tool results, keeping the input to the model compact.

#### Usage

```bash
aux4 ai agent summarize [<historyFile>] [--model <json>] [--models <json>] [--useModel <name>]
```

historyFile   Path to the history JSON file (default: history.json)
--model       Model configuration JSON for the summarization model (required unless --useModel is set)
--models      Models registry as JSON (default: {})
--useModel    Named model from registry to use (default: "")

#### Example

Summarize to stdout:

```bash
aux4 ai agent summarize history.json --model '{"type":"openai","config":{"model":"gpt-4o-mini"}}'
```

Save summary to a file:

```bash
aux4 ai agent summarize history.json --model '{"type":"anthropic","config":{"model":"claude-haiku-4-5-20251001"}}' > summary.md
```

Store summary in the knowledge base:

```bash
aux4 ai agent summarize history.json --model '{"type":"openai","config":{"model":"gpt-4o-mini"}}' > summary.md && aux4 ai agent learn summary.md
```

Summarize using a named model from registry:

```bash
aux4 ai agent summarize history.json --configFile config.yaml --config agent --useModel fast
```
