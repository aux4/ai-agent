#### Description

Start an interactive chat loop with the AI agent. Each user input is logged and sent through the ask pipeline. The conversation continues until the user types `exit`. History is saved automatically between turns so the agent maintains context throughout the session.

The chat command supports the same features as the ask command (instructions, images, context, model configuration, permissions, compaction, model selection, agent identity) but is designed for multi-turn interactive sessions.

Pass `--bio` (a JSON object with `name`, `role`, `description`) to give the agent a persona for the session; it is rendered as a `# Agent Identity` system section so the agent knows who it is across every turn. Chat does not accept `--baseInstructions`.

#### Usage

```bash
aux4 ai agent chat [--instructions <file>] [--bio <json>] [--role <role>] [--history <file>] [--outputSchema <file>] [--context <true|false>] [--image <paths>] [--storage <dir>] [--model <json>] [--autoCompact <true|false>] [--compaction <json>] [--permissions <json>] [--models <json>] [--useModel <name>] [--references <dir>] [--skills <dir>] <text>
```

--instructions   Prompt instructions file (default: AGENTS.md; falls back to AGENT.md then instructions.md if not found)
--bio            Agent identity as a JSON object with name, role, description — rendered as a `# Agent Identity` system section (default: "")
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
--models         Models registry as JSON (default: {})
--useModel       Named model from registry to use for this request (default: "")
--references     Path to the references directory (default: ${packageDir}/references)
--skills         Path to the skills directory (default: skills)
text             Initial text to send (positional argument)

#### Example

Start a chat session:

```bash
aux4 ai agent chat "Hello, I'd like to discuss my project" --config
```

The agent responds and waits for the next input. Type `exit` to end the session.

Start a chat with an agent identity:

```bash
aux4 ai agent chat "Hi" --config \
  --bio '{"name":"Ada","role":"release manager","description":"Owns the CI/CD pipeline"}'
```

The persona persists across every turn of the session.
