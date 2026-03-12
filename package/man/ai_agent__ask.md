#### Description

Ask a single question to the AI agent. The agent composes the prompt using an instructions file, optional conversation history, optional images, and retrieves relevant documents from the local vector store when configured. The response is printed to stdout.

Key features:

- **Prompt instructions** — load a custom instructions file to shape the assistant's behavior
- **Context from stdin** — pipe additional context into the prompt with `--context true`
- **Image input** — attach one or more images for visual question answering
- **Conversation history** — maintain multi-turn conversations via a history JSON file
- **Structured output** — constrain responses to a JSON schema
- **Streaming** — print tokens as they arrive with `--stream true`
- **Built-in tools** — the agent can call tools (readFile, writeFile, editFile, searchFiles, executeAux4, askUser, etc.) during execution
- **askUser tool** — when the agent needs clarification it can prompt the user interactively; in non-interactive sessions it proceeds with best judgment

#### Usage

```bash
aux4 ai agent ask [--instructions <file>] [--role <role>] [--history <file>] [--outputSchema <file>] [--context <true|false>] [--image <paths>] [--storage <dir>] [--stream <true|false>] <question>
```

--instructions   Prompt instructions file (default: instructions.md)
--role           Role used in the prompt (default: user)
--history        History JSON file for multi-turn conversations (default: "")
--outputSchema   JSON schema file to constrain structured output (default: schema.json)
--context        Read additional context from stdin (default: false)
--image          Image path(s), comma-separated for multiple (default: "")
--storage        Storage directory for the vector store (default: .context)
--stream         Enable streaming token output (default: false)
question         The question to ask (positional argument)

#### Example

Basic question:

```bash
aux4 ai agent ask --config --question "What's the capital of France? Just output the name of the city, nothing else."
```

```text
Paris
```

Streaming output:

```bash
aux4 ai agent ask --config --stream true --question "Explain what AI agents are in two sentences."
```

Tokens are printed to stdout as they arrive from the LLM.

With an image:

```bash
aux4 ai agent ask "Can you see geometric shapes in this image? Answer only yes or no." --image shapes.png --config
```

```text
yes
```

With piped context:

```bash
cat report.txt | aux4 ai agent ask --context true "Summarize the key findings"
```
