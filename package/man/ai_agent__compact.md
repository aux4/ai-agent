#### Description

Compact a conversation history file by summarizing older messages into a single summary while keeping the most recent messages verbatim. This reduces context size for long-running conversations without losing important information.

The compaction process:
1. Separates system messages from conversation messages
2. Summarizes older messages using the specified model
3. Keeps the most recent messages unchanged
4. Writes the compacted history back to the file

The summary preserves key facts, decisions, tool results, and user preferences from the older messages.

#### Usage

```bash
aux4 ai agent compact [<historyFile>] [--model <json>] [--keepLastMessages <n>]
```

historyFile         Path to the history JSON file (default: history.json)
--model             Model configuration JSON for the summarization model (required)
--keepLastMessages  Number of recent messages to keep verbatim (default: 6)

#### Example

Compact using an OpenAI model:

```bash
aux4 ai agent compact history.json --model '{"type":"openai","config":{"model":"gpt-4o-mini"}}'
```

Compact using Anthropic with more kept messages:

```bash
aux4 ai agent compact history.json --model '{"type":"anthropic","config":{"model":"claude-haiku-4-5-20251001"}}' --keepLastMessages 10
```

Progress is printed to stderr. The summary content is printed to stdout.
