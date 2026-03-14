#### Description

Generate a concise memory entry from a conversation history file. The memory entry captures key facts, decisions, outcomes, and preferences — designed to be stored in a knowledge base for future reference.

Unlike `summarize` which produces a detailed markdown document, `remember` generates a short, factual entry optimized for retrieval and context injection in future sessions.

#### Usage

```bash
aux4 ai agent remember [<historyFile>] [--model <json>]
```

historyFile   Path to the history JSON file (default: history.json)
--model       Model configuration JSON for the model (required)

#### Example

Generate a memory entry:

```bash
aux4 ai agent remember history.json --model '{"type":"openai","config":{"model":"gpt-4o-mini"}}'
```

Store the memory in the knowledge base:

```bash
MEMORY=$(aux4 ai agent remember history.json --model '{"type":"anthropic","config":{"model":"claude-haiku-4-5-20251001"}}')
aux4 kb add --topic "session-2024-01-15" --content "$MEMORY" --tags session,agent
```
