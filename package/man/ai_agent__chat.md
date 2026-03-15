#### Description

Start an interactive chat loop with the AI agent. Each user input is logged and sent through the ask pipeline. The conversation continues until the user types `exit`. History is saved automatically between turns so the agent maintains context throughout the session.

The chat command supports all the same features as the ask command (instructions, images, context, model configuration, permissions) but is designed for multi-turn interactive sessions.

#### Usage

```bash
aux4 ai agent chat [--instructions <file>] [--role <role>] [--history <file>] [--outputSchema <file>] [--context <true|false>] [--image <paths>] [--storage <dir>] [--model <json>] [--autoCompact <true|false>] [--compaction <json>] [--permissions <json>] <text>
```

--instructions   Prompt instructions file (default: instructions.md)
--role           Role used in the prompt (default: user)
--history        History JSON file (default: history.json)
--outputSchema   JSON schema file for structured output (default: schema.json)
--context        Read additional context from stdin (default: false)
--image          Image path(s), comma-separated (default: "")
--storage        Storage directory for the vector store (default: .context)
--model          Model configuration JSON (default: {})
--autoCompact    Enable auto-compaction of conversation history (default: false)
--compaction     Compaction configuration as JSON (default: {})
--permissions    Permissions config as JSON with allow, ask, deny arrays (default: {})
text             Initial text to send (positional argument)

#### Example

Start a chat session:

```bash
aux4 ai agent chat "Hello, I'd like to discuss my project" --config
```

The agent responds and waits for the next input. Type `exit` to end the session.
