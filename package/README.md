# aux4/ai-agent

AI agent

This package provides a small aux4-powered AI agent that can learn from documents, run semantic searches against a local vector store, ask questions to a configured LLM, run interactive chat sessions, generate and inspect images, and call aux4 tools during conversations. It's designed as a lightweight RAG (retrieval-augmented generation) and assistant runtime that fits into the aux4 ecosystem.

Main use cases:
- Ingest plain text documents into a local vector store and run semantic queries (learn + search).
- Ask direct or contextual questions to an LLM using a prompt template and optional context or images.
- Generate images from text prompts and save them to disk (single or multiple images).
- Let the agent call local aux4 commands/tools as part of a workflow (tool usage).
- Inspect conversation history and run interactive chat loops.

This README describes installation, the primary commands, parameters, and realistic examples taken from the test suite so you can get started quickly.

## Installation

```bash
aux4 aux4 pkger install aux4/ai-agent
```

## Quick Start

The single most common use case is asking a quick factual question using the package's ask command. The tests use the following invocation:

```bash
aux4 ai agent ask --config --question "What's the capital of France? Just output the name of the city, nothing else."
```

This runs the agent using the configured instructions and prompt behavior (the --config flag tells the agent to load configured instructions). The test expects the agent to return:

Paris

(Only the city name is returned because the question explicitly requests it.)

For command documentation see [aux4 ai agent ask](./commands/ai/agent/ask).

---

## The Ask (Basic)

Overview
The ask family of commands provide direct question answering and short interactions with the configured LLM and retrieval system. You can pass prompt instructions, supply history, include images for visual question answering, and output structured JSON by providing an output schema.

Commands covered here:
- ask
- chat
- history

### aux4 ai agent ask
Overview:
Ask a single question to the agent. The agent composes the prompt using an instructions file, optional context, optional images, and retrieves relevant documents from the local vector store when available.

Key variables (from the package help):
- instructions (default: instructions.md) — prompt instructions file to shape the assistant.
- role (default: user) — role used in the prompt.
- history (default: "") — a history file to seed the conversation.
- outputSchema (default: schema.json) — path to a JSON file defining the structured output format (see [Output Schema](#output-schema)).
- context (default: "false") — read additional context from stdin (set to true to pipe context).
- image (default: "") — path(s) to image(s) to attach (comma-separated if multiple).
- storage (default: .llm) — the storage directory for the vector store.
- stream (default: "false") — enable streaming output (tokens are printed as they arrive).
- permissions (default: "{}") — permissions configuration as JSON with allow, ask, deny arrays (see [Permissions](#permissions)).
- models (default: "{}") — models registry as JSON (see [Model Selection](#model-selection)).
- useModel (default: "") — named model from registry to use for this request.
- references (default: "${packageDir}/references") — path to the references directory (see [References](#references)).
- question (arg: true) — the question to ask (positional/argument).

Usage examples (from tests):

1) Basic question (test example):

```bash
aux4 ai agent ask --config --question "What's the capital of France? Just output the name of the city, nothing else."
```

This returns only "Paris" in the test expectation.

2) Asking with an image (see Images section for how images are generated, then you can call ask to inspect):

```bash
aux4 ai agent ask "Can you see geometric shapes in this image? Answer only yes or no." --image 1-multi-test.png --config
```

The test expects a partial response "yes".

3) Streaming output (tokens print as they arrive):

```bash
aux4 ai agent ask --config --stream true --question "Explain what AI agents are in two sentences."
```

Notes:
- Use --config when you want the agent to use the configured instructions file (instructions.md) as in the tests.
- The question can be provided via the --question flag or as a final positional argument.
- Provide multiple image paths separated by commas if needed.
- Use `--stream true` for real-time token output — useful for long responses or interactive workflows.

For more details see [aux4 ai agent ask](./commands/ai/agent/ask).

### aux4 ai agent chat
Overview:
An interactive chat loop that sets question text, logs the user input, then delegates to the ask flow repeatedly. The chat command uses the same prompt instructions, history and image options but is designed to loop until you type exit.

Key variables:
- instructions (default: instructions.md)
- role (default: user)
- history (default: history.json)
- outputSchema (default: schema.json)
- context (default: "false")
- image (default: "")
- storage (default: .llm)
- model (default: "{}") — model configuration JSON
- text (arg: true) — text to send in this chat step

Usage:
Start a chat by sending an initial input:

```bash
aux4 ai agent chat "Hello, I'd like to start a session" --config
```

The command logs each user turn and uses the ask pipeline for responses. Typing "exit" ends the loop.

For more details see [aux4 ai agent chat](./commands/ai/agent/chat).

### aux4 ai agent history
Overview:
Display a formatted view of conversation history JSON.

Key variables:
- historyFile (arg: true, default: history.json) — history file to show.

Usage example (test uses this to inspect tool calls and outputs):

```bash
aux4 ai agent history
```

This prints conversation entries in a readable format. In tests it is used to confirm tool invocations are recorded.

For more details see [aux4 ai agent history](./commands/ai/agent/history).

---

## Learn & Search

Overview
This group handles ingesting documents into a local vector store and running semantic queries. It's the RAG (retrieval-augmented generation) side of the agent.

Commands:
- learn
- search
- forget

### aux4 ai agent learn
Overview:
Index one or more documents into the local storage directory (.llm by default), preparing them for semantic search.

Key variables:
- storage (default: .llm) — the storage directory to write vector store and metadata.
- doc (arg: true) — file path to the document to learn from.
- type (default: "") — optional document type.

Real example (from tests):
Create simple document files then learn them.

france.txt:
```text
Capital of France is London
```

england.txt:
```text
Capital of England is London
```

spain.txt:
```text
Capital of Spain is Madrid
```

Commands from tests:

```bash
aux4 ai agent learn france.txt
aux4 ai agent learn england.txt
aux4 ai agent learn spain.txt
```

After learning, a search like the following returns the most relevant stored sentence.

```bash
aux4 ai agent search "What is the capital of France?"
```

Expected result in the test initially:
Capital of France is London

The tests also demonstrate updating a file and re-learning to update the store:
```bash
echo "Capital of France is Paris" > france.txt
aux4 ai agent learn france.txt
aux4 ai agent search "What is the capital of France?"
```
Expected now:
Capital of France is Paris

Notes:
- Documents are stored in the storage directory (.llm by default). Re-learning the same document will update the indexed content.
- Use simple plain text documents for predictable retrieval behavior as shown in the tests.

For more details see [aux4 ai agent learn](./commands/ai/agent/learn).

### aux4 ai agent search
Overview:
Run a query against the local vector store to retrieve relevant text snippets or structured data.

Key variables:
- storage (default: .llm)
- format (default: text) — "text" or "json"
- source (default: "") — limit search to a specific source path
- limit (default: "1") — number of results to return
- query (arg: true) — the search query

Usage example (from tests):

```bash
aux4 ai agent search "What is the capital of England?"
```

Expected:
Capital of England is London

Edge cases:
- If no documents exist in storage, the command returns the error:
No documents have been indexed yet. Please use 'aux4 ai agent learn <document>' to add documents to the vector store first.
This behavior is exercised in the tests and is useful for detecting an empty store before trying to search.

For more details see [aux4 ai agent search](./commands/ai/agent/search).

### aux4 ai agent forget
Overview:
Remove the local vector store files to forget learned documents. This is handy in tests or when you want to reset state.

Key variables:
- storage (default: .llm)

Behavior (test expectation and usage):

```bash
aux4 ai agent forget
```

This deletes the vector store artifacts in the storage directory (docstore.json, faiss.index, ids.json) and subsequent searches will report that no documents are indexed.

For more details see [aux4 ai agent forget](./commands/ai/agent/forget).

---

## Images

Overview
Generate images from text prompts and optionally use images as context for questions.

Command:
- image
- ask (image support described in Ask section)

### aux4 ai agent image
Overview:
Generate images from a textual prompt. You can request multiple images at once; the command saves the results to disk and prints progress.

Key variables:
- prompt (arg: true) — the text prompt describing the image to generate.
- image — file path where to save the generated image.
- size (default: 1024x1024) — resolution (examples: 1024x1024, 1792x1024).
- quality (default: auto) — quality parameter and accepts options like standard, hd, low, medium, high, auto (implementation dependent on selected image backend).
- context (default: false) — read extra context from stdin.
- model (default: "{}") — model configuration JSON (for example: {"type":"openai","config":{"model":"dall-e-3"}}).
- quantity (default: "1") — number of images to generate; if >1, outputs are numbered files.

Examples (from tests):

1) Single image generation (test):

```bash
aux4 ai agent image --prompt "full white background, red circle 2D (not a sphere) in the middle, no shadow, no details, simple drawing, nothing else" --image image-test.png
```

Expected test output:
Generating image...
Image saved to image-test.png

2) Multiple images with specific model and lower quality (test):

```bash
aux4 ai agent image --prompt "simple geometric shapes on white background" --image multi-test.png --quantity 3 --quality low --model '{"type":"openai","config":{"model":"gpt-image-1-mini"}}'
```

Expected test output sequence:
Generating image...
Generating image 1/3...
Generating image 2/3...
Generating image 3/3...
Image saved to 1-multi-test.png
Image saved to 2-multi-test.png
Image saved to 3-multi-test.png

Using images as input to ask:
After generating or saving an image, you can pass the saved filename(s) to the ask command with the --image parameter. For example (from tests):

```bash
aux4 ai agent ask "Can you see geometric shapes in this image? Answer only yes or no." --image 1-multi-test.png --config
```

The test expects a partial match "yes".

Notes:
- The package supports a pluggable model configuration via the model JSON parameter. Use model JSON to pick the image backend/configuration when available.
- When quantity > 1, files are created with numbered prefixes (e.g., 1-multi-test.png, 2-multi-test.png, ...).

For more details see [aux4 ai agent image](./commands/ai/agent/image).

---

## Model Selection

The agent supports a named model registry so you can define multiple models and select one by name with `--useModel` instead of passing inline model JSON every time.

### Configuration

Define named models in your `config.yaml`:

```yaml
config:
  agent:
    models:
      strong:
        type: bedrock
        config:
          model: global.anthropic.claude-sonnet-4-5-20250929-v1:0
        description: "Complex reasoning, code generation, multi-step analysis"
      fast:
        type: bedrock
        config:
          model: global.anthropic.claude-haiku-4-5-20251001-v1:0
        description: "Simple questions, factual lookups, formatting, routine tasks"
    model:
      type: bedrock
      config:
        model: global.anthropic.claude-sonnet-4-5-20250929-v1:0
```

- `model` — the default model used when `--useModel` is not provided
- `models` — optional registry of named models, each with `type`, `config`, and optional `description`

### Usage

Select a named model with `--useModel`:

```bash
aux4 ai agent ask --configFile config.yaml --config agent --useModel fast "What is 2+2?"
```

The `--useModel` flag works on `ask`, `chat`, `summarize`, `remember`, and `compact` commands.

If `--useModel` is not provided, the default `model` is used — no change to existing behavior.

**Graceful fallback:** If the name passed to `--useModel` is not found in the registry, the agent silently falls back to the default `model`. This allows skills and agents to request model intents (e.g., `conversation`, `vision`) without requiring every deployment to configure them.

### Listing available models

```bash
aux4 ai agent models --configFile config.yaml --config agent
```

```text
  strong  bedrock  global.anthropic.claude-sonnet-4-5-20250929-v1:0  Complex reasoning, code generation, multi-step analysis
  fast    bedrock  global.anthropic.claude-haiku-4-5-20251001-v1:0   Simple questions, factual lookups, formatting, routine tasks
```

### Self-delegation

Agents can delegate tasks to themselves using different models. For example, use the fast model for simple lookups and the strong model for complex reasoning:

```bash
# Simple task — use fast model
aux4 ai agent ask --useModel fast --instructions agent.md "Summarize this paragraph"

# Complex task — use strong model
aux4 ai agent ask --useModel strong --instructions agent.md "Analyze this codebase and suggest improvements"
```

For more details see [aux4 ai agent models](./commands/ai/agent/models).

---

## Built-in Tools

The agent comes with a set of built-in tools that the LLM can call during execution. These tools run locally and are always available:

| Tool | Description |
|------|-------------|
| `readFile` | Read the contents of a text file |
| `writeFile` | Create or overwrite a file |
| `editFile` | Perform partial string replacements in a file |
| `listFiles` | List files in a directory |
| `searchFiles` | Search file contents for a text pattern |
| `createDirectory` | Create a new directory |
| `removeFiles` | Remove files or directories created by the agent |
| `saveImage` | Save a base64-encoded image to disk |
| `executeAux4` | Run any aux4 command |
| `searchContext` | Query the local vector store for relevant context |
| `askUser` | Ask the user a question and wait for their typed response |
| `currentDateTime` | Get the current date and time in local and UTC formats |
| `readReference` | List or read reference documents from the references directory |

### askUser

The `askUser` tool lets the agent prompt the user interactively when it needs clarification, a preference, or a decision before proceeding. The question is displayed on stderr and the user types their response on stdin.

**Non-interactive sessions:** When no TTY is available (e.g., piped input), the tool returns a message telling the agent to proceed with its best judgment.

**Note:** The agent is instructed to always call `askUser` alone, never in parallel with other tools, to avoid stdin conflicts.

### searchFiles

The `searchFiles` tool performs a case-insensitive text search across project files. It supports filtering by file extension, excluding directories, and limiting results. The agent uses this to find relevant code or content without reading every file.

### currentDateTime

The `currentDateTime` tool returns the current date and time in both local and UTC formats. The agent calls this when it needs to know the current date, time, day of the week, or timezone. It takes no parameters.

### readReference

The `readReference` tool gives the agent on-demand access to reference documents without loading them all into the prompt. This keeps the system prompt small while still making detailed knowledge available.

- **List references:** Call with no `file` parameter to get a list of all available `.md` files.
- **Read a reference:** Call with a `file` parameter (e.g., `api/endpoints.md`) to read its content.

The tool searches the references directory recursively, so nested folders are supported. File paths returned by the list operation are relative to the references root (e.g., `guides/setup.md`).

By default, the references directory is `${packageDir}/references` — any agent package can ship reference documents by placing `.md` files there. Override with `--references <path>` to use a custom directory.

---

## References

Reference documents let you provide detailed knowledge to the agent without bloating the system prompt. Instead of putting everything in `instructions.md`, place detailed documents in a `references/` directory and the agent will look them up on demand using the `readReference` tool.

### Setup

Create a `references/` directory in your package with `.md` files:

```
my-agent/
├── package/
│   ├── .aux4
│   ├── references/
│   │   ├── api.md
│   │   ├── database.md
│   │   └── guides/
│   │       ├── setup.md
│   │       └── deployment.md
│   └── ...
```

Nested folders are supported — the agent sees them as relative paths like `guides/setup.md`.

### Usage

Mention the references in your `instructions.md` so the agent knows to look them up:

```markdown
You are a project assistant. When the user asks about the API or database,
check the references for detailed documentation before answering.
```

The agent will automatically call `readReference` to list available documents and read the relevant ones.

### Custom References Path

Override the default path with `--references`:

```bash
aux4 ai agent ask "How do I deploy?" --references ./docs/references
```

---

## Permissions

The agent supports a permissions system that controls which aux4 commands the agent can execute and which file operations it can perform. Permissions are configured via `config.yaml` or passed inline as JSON with the `--permissions` flag.

### Configuration

```yaml
config:
  permissions:
    allow:
      - "*"              # allow all aux4 commands
      - "file:read:*"    # allow reading all files
      - "file:write:*"   # allow writing all files
      - "file:delete:*"  # allow deleting all files
    ask:
      - "file:write:*.env"  # prompt user before modifying .env files
    deny:
      - "deploy*"           # block deploy commands
      - "file:delete:*"     # block all file deletions
```

Default values: `allow: ["*", "file:read:*", "file:write:*", "file:delete:*"]`, `ask: []`, `deny: []` — everything is allowed by default for backward compatibility.

### Pattern Types

| Pattern | Matches |
|---------|---------|
| `hello` | aux4 command `hello` |
| `aux4:hello` | aux4 command `hello` (explicit prefix, same as above) |
| `config*` | any aux4 command starting with `config` |
| `file:read:*.env` | reading any `.env` file |
| `file:write:src/*` | writing or editing files in `src/` |
| `file:delete:*` | deleting any file |

Patterns without a `file:` prefix are command patterns. The `aux4:` prefix on command patterns is optional and stripped before matching. File patterns only match file operations and command patterns only match command executions — they never cross-match.

### Evaluation Order

1. **deny** — if any deny pattern matches, the operation is blocked
2. **ask** — if any ask pattern matches, the user is prompted for confirmation (Y/n)
3. **allow** — if any allow pattern matches, the operation is permitted
4. **no match** — if nothing matches, the operation is blocked

### Protected Operations

The permissions system covers these tool operations:

| Tool | Permission Scope |
|------|-----------------|
| `readFile` | `file:read:<path>` |
| `writeFile` | `file:write:<path>` |
| `editFile` | `file:write:<path>` |
| `saveImage` | `file:write:<path>` |
| `listFiles` | `file:read:<path>` |
| `searchFiles` | `file:read:<path>` |
| `removeFiles` | `file:delete:<path>` |
| `executeAux4` | command name (e.g., `hello`, `config get`) |

### Examples

Block the agent from writing any files:

```bash
aux4 ai agent ask "Write hello to output.txt" --config --permissions '{"allow":["*","file:read:*"],"deny":["file:write:*"]}'
```

Allow all commands but prompt before running deploy:

```yaml
config:
  permissions:
    allow:
      - "*"
      - "file:read:*"
      - "file:write:*"
      - "file:delete:*"
    ask:
      - "deploy*"
    deny: []
```

**Note:** File permission checks run after the existing path security checks (current directory bounds), adding a second layer of protection.

---

## Tools

Overview
The agent can call local aux4 commands (tools) during execution. This enables safe tool use patterns like looking up or running local commands, generating data with small auxiliary commands, or calling other package commands.

The test suite demonstrates creating a simple tool and letting the AI call it.

Example tool definition used in the tests (the test writes this snippet to a .aux4 file for the test environment):

```json
{
  "profiles": [
    {
      "name": "main",
      "commands": [
        {
          "name": "print-name",
          "execute": [
            "echo User $lastName, $firstName from the tool"
          ],
          "help": {
            "text": "Prints the user's full name",
            "variables": [
              {
                "name": "firstName",
                "text": "The user's first name"
              },
              {
                "name": "lastName",
                "text": "The user's last name"
              }
            ]
          }
        }
      ]
    }
  ]
}
```

Using the tool directly (test):

```bash
aux4 print-name --firstName "Jane" --lastName "Doe"
```

Expected:
User Doe, Jane from the tool

Letting the agent invoke the tool
The tests demonstrate instructing the agent to call the aux4 tool and return only the tool output. The ai agent can use the executeAux4 integration to run local commands during a response. Example from tests:

```bash
aux4 ai agent ask "print the user name John Doe using the aux4 tool, calling print-name command, using the --firstName and --lastName parameters. Just output the tool output nothing else. No explanations." --config --history history.json
```

Expected:
User Doe, John from the tool

The history command is then used in the tests to confirm that the agent recorded the executeAux4 call:

```bash
aux4 ai agent history
```

The test expects parts of the history to include:
executeAux4(command: print-name --firstName John --lastName Doe)
and the tool output lines "User Doe, John from the tool".

Notes:
- Tools run by the agent must be available in the active aux4 environment.
- When writing prompts that instruct the agent to call tools, be specific about the expected output and constraints (for example, "Just output the tool output nothing else").
- The agent records tool invocations in history; you can inspect them with aux4 ai agent history.

For more details see the related command docs:
- The example tool command is available at [aux4 print-name](./commands/print-name) after installing or configuring it locally.
- Agent calls are documented under [aux4 ai agent ask](./commands/ai/agent/ask) and [aux4 ai agent history](./commands/ai/agent/history).

---

## Output Schema

The `--outputSchema` parameter accepts a path to a JSON file that defines the structure of the agent's response. Each key is a field name and each value is an object with a `type` and `description`:

```json
{
  "fieldName": { "type": "string", "description": "Description of this field" },
  "count": { "type": "number", "description": "A numeric value" },
  "active": { "type": "boolean", "description": "Whether active" }
}
```

### Supported Types

| Type | Description | Extra Fields |
|------|-------------|--------------|
| `string` | Text value | — |
| `number` | Numeric value | — |
| `boolean` | True/false value | — |
| `array` | List of values | `items` — element type (e.g. `"string"`) |
| `enum` | One of a fixed set of values | `values` — array of allowed strings |

### Example

schema.json:
```json
{
  "name": { "type": "string", "description": "The person's full name" },
  "age": { "type": "number", "description": "The person's age" },
  "employed": { "type": "boolean", "description": "Whether the person is employed" },
  "skills": { "type": "array", "items": "string", "description": "List of skills" },
  "role": { "type": "enum", "values": ["engineer", "manager", "designer"], "description": "Job role" }
}
```

```bash
aux4 ai agent ask "Tell me about John Doe" --outputSchema schema.json --config
```

Response:
```json
{
  "name": "John Doe",
  "age": 30,
  "employed": true,
  "skills": ["Go", "JavaScript"],
  "role": "engineer"
}
```

### Notes

- Fields are returned with their actual types (booleans, numbers, etc.) — no string coercion needed.
- The agent injects format instructions into the prompt automatically, telling the LLM to respond with JSON matching the schema.
- Streaming (`--stream true`) is disabled when an output schema is set, since the full response must be parsed as JSON.

---

## Examples

### Example 1 — Learn documents and search (simple RAG)
Create small files and index them, then query:

france.txt:
```text
Capital of France is London
```

england.txt:
```text
Capital of England is London
```

spain.txt:
```text
Capital of Spain is Madrid
```

Commands:

```bash
aux4 ai agent learn france.txt
aux4 ai agent learn england.txt
aux4 ai agent learn spain.txt
aux4 ai agent search "What is the capital of Spain?"
```

This returns:
Capital of Spain is Madrid

Then update france.txt and re-learn:

```bash
echo "Capital of France is Paris" > france.txt
aux4 ai agent learn france.txt
aux4 ai agent search "What is the capital of France?"
```

Now the search returns:
Capital of France is Paris

### Example 2 — Image generation and inspection
Generate a simple single image:

```bash
aux4 ai agent image --prompt "full white background, red circle 2D (not a sphere) in the middle, no shadow, no details, simple drawing, nothing else" --image image-test.png
```

Expect:
Generating image...
Image saved to image-test.png

Generate multiple images (3) and then ask a question about one image:

```bash
aux4 ai agent image --prompt "simple geometric shapes on white background" --image multi-test.png --quantity 3 --quality low --model '{"type":"openai","config":{"model":"gpt-image-1-mini"}}'
# after the images are generated, ask about the first one:
aux4 ai agent ask "Can you see geometric shapes in this image? Answer only yes or no." --image 1-multi-test.png --config
```

Expected image generation output includes:
Generating image 1/3...
...
Image saved to 1-multi-test.png
And the ask command expects a partial "yes" answer in the test.

### Example 3 — Use the agent as a tool orchestrator
Create a small tool in your environment (the test demonstrates how a .aux4 command called print-name works). Called directly:

```bash
aux4 print-name --firstName "Jane" --lastName "Doe"
```

Expect:
User Doe, Jane from the tool

Ask the agent to invoke the tool and return the tool output (test example):

```bash
aux4 ai agent ask "print the user name John Doe using the aux4 tool, calling print-name command, using the --firstName and --lastName parameters. Just output the tool output nothing else. No explanations." --config --history history.json
```

Expect:
User Doe, John from the tool

Then inspect the recorded history:

```bash
aux4 ai agent history
```

The history includes the executeAux4 invocation and the tool outputs.

### Example 4 — Contextual structured outputs (search + JSON)
The tests include context-driven examples where the agent is configured with instructions and asked to return strict JSON based on search results. Use instructions.md and schema.json to constrain responses and call ask with --config to apply them:

```bash
aux4 ai agent ask "What is the role and company of John Doe?" --config
```

The test expects structured JSON, for example:

```json
{
  "name": "John Doe",
  "role": "Engineer",
  "company": "ACME Corp"
}
```

This pattern is used in the context tests where several context files are learned first and then the agent is queried.

---

## License

This package is licensed under the Apache License.

See [LICENSE](./license) for details.
