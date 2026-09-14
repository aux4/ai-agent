# ai agent run-tools-and-resume

## command surface

### should describe the fused bounded orchestration primitive

```execute
AUX4_NO_DAEMON=1 aux4 ai agent run-tools-and-resume --help
```

```expect:partial
Execute a batch of external tool calls and resume one planning turn in the same warm runtime
```

## history seed validation

### should reject a seed that is not a checkpoint before any tool runs

```timeout
15000
```

```execute
AUX4_NO_DAEMON=1 aux4 ai agent run-tools-and-resume --toolCalls '[{"id":"t1","name":"currentDateTime","arguments":{}}]' --history /tmp/aux4-invalid-fused-history.json --historySeed '{"notMessages":[]}'
```

```error:partial
History seed must be an object with a messages array
```
