# executeAux4 timeouts

`executeAux4` defaults to a 60 second timeout. Commands that legitimately run for
minutes (a remote browser task) get a longer one by pattern — from the host's
`AUX4_AGENT_TOOL_TIMEOUTS` env (JSON) or `permissions.timeouts` — and a timed-out
command is only pointed at `aux4 jobs` where aux4/jobs is installed.

```file:.aux4
{
  "profiles": [
    {
      "name": "main",
      "commands": [
        {
          "name": "slow",
          "execute": [
            "sleep 3",
            "echo finished"
          ],
          "help": {
            "text": "Take three seconds"
          }
        }
      ]
    }
  ]
}
```

## a configured pattern raises the timeout the model asked for

```timeout
30000
```

```execute
AUX4_AGENT_TOOL_TIMEOUTS='{"aux4 slow*": 10}' aux4 ai agent run-tool '{"id":"t1","name":"executeAux4","arguments":{"command":"aux4 slow","timeout":1}}' --tools executeAux4
```

```expect:partial
finished
```

## permissions.timeouts works the same way

```timeout
30000
```

```execute
aux4 ai agent run-tool '{"id":"t2","name":"executeAux4","arguments":{"command":"slow","timeout":1}}' --tools executeAux4 --permissions '{"timeouts":{"slow":10}}'
```

```expect:partial
finished
```

## a longer timeout from the model is kept

```timeout
30000
```

```execute
AUX4_AGENT_TOOL_TIMEOUTS='{"aux4 slow*": 1}' aux4 ai agent run-tool '{"id":"t3","name":"executeAux4","arguments":{"command":"aux4 slow","timeout":10}}' --tools executeAux4
```

```expect:partial
finished
```

## without aux4/jobs the timeout suggests a longer retry, not jobs run

```timeout
30000
```

```execute
AUX4_AGENT_TOOL_TIMEOUTS='{}' AUX4_AGENT_JOBS_AVAILABLE=false aux4 ai agent run-tool '{"id":"t4","name":"executeAux4","arguments":{"command":"aux4 slow","timeout":1}}' --tools executeAux4 | node -e "
  const out = JSON.parse(require('fs').readFileSync(0, 'utf8')).content;
  console.log('killed:' + out.includes('was killed after 1 seconds'));
  console.log('noJobs:' + out.includes('Background jobs are not available here'));
  console.log('retry:' + out.includes('120'));
  console.log('jobsRun:' + out.includes('jobs run'));
"
```

```expect
killed:true
noJobs:true
retry:true
jobsRun:false
```
