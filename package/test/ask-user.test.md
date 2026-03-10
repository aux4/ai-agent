# ask user tool (non-interactive)

## Non-interactive session should skip prompting

```timeout
60000
```

```execute
aux4 ai agent ask --config --question "Use the askUser tool to ask me what language I prefer. Just output the tool response, nothing else."
```

```expect:partial
User responded
```
