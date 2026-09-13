# ai agent run-tool

`run-tool` executes one model-produced tool call through the standard ai-agent
tool registry. It emits the result envelope consumed by `ai agent resume`.

## runs a built-in tool

```execute
aux4 ai agent run-tool '{"id":"clock-1","name":"currentDateTime","arguments":{}}'
```

```expect:partial
{"id":"clock-1","content":"Local:
```

## reports an unavailable tool as a result

```execute
aux4 ai agent run-tool '{"id":"missing-1","name":"notInstalled","arguments":{}}' --tools currentDateTime
```

```expect:json
{
  "id": "missing-1",
  "content": "Error: tool \"notInstalled\" is not available."
}
```

## returns tool validation failures to the next planning turn

```execute
aux4 ai agent run-tool '{"id":"invalid-1","name":"readFile","arguments":{}}' --tools readFile
```

```expect:partial
{"id":"invalid-1","content":"Error:
```
