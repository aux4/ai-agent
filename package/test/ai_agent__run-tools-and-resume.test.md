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
AUX4_NO_DAEMON=1 aux4 ai agent run-tools-and-resume --toolCallsBase64 W3siaWQiOiJ0MSIsIm5hbWUiOiJjdXJyZW50RGF0ZVRpbWUiLCJhcmd1bWVudHMiOnt9fV0= --history /tmp/aux4-invalid-fused-history.json --historySeedBase64 eyJub3RNZXNzYWdlcyI6W119
```

```error:partial
History seed must be an object with a messages array
```
