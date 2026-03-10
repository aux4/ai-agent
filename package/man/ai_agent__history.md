#### Description

Display a formatted view of a conversation history JSON file. Shows user messages, assistant responses, and tool invocations in a readable format. Useful for inspecting what the agent did during a previous session, including which tools were called and their results.

#### Usage

```bash
aux4 ai agent history [<historyFile>]
```

historyFile   Path to the history JSON file (default: history.json)

#### Example

View the default history file:

```bash
aux4 ai agent history
```

View a specific history file:

```bash
aux4 ai agent history session-2024.json
```

Example output includes tool call records:

```text
executeAux4(command: print-name --firstName John --lastName Doe)
User Doe, John from the tool
```
