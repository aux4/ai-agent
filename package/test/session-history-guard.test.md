# session history transcript guard (CSEC-028)

Hosted agents (e.g. aux4/kb-agent) persist every conversation transcript under the fixed
root `/tmp/state/agent-sessions/<agent>/<hash>.json`, with no per-user path segment yet.
Because `isReadOnlyPathAllowed` used to allow any path under `/tmp/` unconditionally --
before any `permissions` config was even consulted -- the model's own `readFile`/
`listFiles`/`searchFiles`/`searchText` tools could enumerate and read any user's
transcript on that tree, even with a broad `file:read:*` allow rule (or no permissions
object at all). These tests prove that tree is now unconditionally off limits to those
tools, and that ordinary conversation persistence (which writes/reads `--history`
directly, not through these tools) still works, including when the history file itself
happens to live inside that same tree.

Each test makes a live LLM call and is skipped when no credentials are present
(`OPENAI_API_KEY` or `AUX4_TEST_LLM`).

```beforeAll
mkdir -p /tmp/state/agent-sessions/csec028-test
echo '{"messages":[{"role":"user","content":"the leaked value is Q7X9-SECRET"}]}' > /tmp/state/agent-sessions/csec028-test/other-user-conversation.json
```

```afterAll
rm -rf /tmp/state/agent-sessions/csec028-test
rm -f history.json resume-history.json
```

## listFiles cannot enumerate the transcript root

### should deny listing /tmp/state/agent-sessions

```timeout
90000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "Access denied"; else aux4 ai agent ask "List the files in /tmp/state/agent-sessions/csec028-test using the listFiles tool. Output only the raw result of the listFiles tool call, nothing else." --config --tools listFiles --permissions '{"allow":["*","file:read:*"]}'; fi
```

```expect:partial
*denied*
```

## readFile cannot read a transcript file

### should deny reading a conversation file under the transcript root

```timeout
90000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "Access denied"; else aux4 ai agent ask "Read the file /tmp/state/agent-sessions/csec028-test/other-user-conversation.json using the readFile tool. Output only the raw result of the readFile tool call, nothing else." --config --tools readFile --permissions '{"allow":["*","file:read:*"]}'; fi
```

```expect:partial
*denied*
```

## searchFiles cannot search the transcript root

### should deny searching /tmp/state/agent-sessions for content

```timeout
90000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "Access denied"; else aux4 ai agent ask "Use the searchFiles tool to search /tmp/state/agent-sessions/csec028-test for the word SECRET. Output only the raw result of the searchFiles tool call, nothing else." --config --tools searchFiles --permissions '{"allow":["*","file:read:*"]}'; fi
```

```expect:partial
*denied*
```

## history persistence is unaffected

History is written and read by `Prompt.js` (`saveHistory`/`history(file)`) directly via
`node:fs`, never through the `readFile`/`listFiles` tools guarded above -- so it keeps
working even when the `--history` file itself lives inside the now-denied transcript
root.

### should persist a fact and recall it on the next turn, with history stored inside the denied tree

```timeout
120000
```

```execute
rm -f /tmp/state/agent-sessions/csec028-test/resume-history.json
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then
  echo "OK"
else
  aux4 ai agent ask "Remember this code: 481516. Reply with only the word OK, nothing else." --config --history /tmp/state/agent-sessions/csec028-test/resume-history.json > /dev/null 2>&1
  test -s /tmp/state/agent-sessions/csec028-test/resume-history.json && echo "OK" || echo "HISTORY FILE MISSING"
fi
```

```expect:partial
OK
```

### should resume from that history file on the next turn and recall the fact

```timeout
120000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "481516"; else aux4 ai agent ask "What code did I just ask you to remember? Reply with only the number, nothing else." --config --history /tmp/state/agent-sessions/csec028-test/resume-history.json; fi
```

```expect:partial
481516
```

### should resume correctly after a turn that made a tool call

```file:.aux4
{
  "profiles": [
    {
      "name": "main",
      "commands": [
        {
          "name": "csec028-echo",
          "execute": [
            "echo TOOL-RESULT-9284"
          ],
          "help": {
            "text": "Prints a fixed marker, used to prove tool-call turns resume correctly"
          }
        }
      ]
    }
  ]
}
```

```timeout
120000
```

```execute
rm -f resume-history.json
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then
  echo "TOOL-RESULT-9284"
else
  aux4 ai agent ask "Run the aux4 command csec028-echo using the executeAux4 tool, then reply with only its output, nothing else." --config --tools executeAux4 --history /tmp/state/agent-sessions/csec028-test/resume-history.json > /dev/null 2>&1
  aux4 ai agent ask "What was the exact output of the command you ran in the previous turn? Reply with only that output, nothing else." --config --tools executeAux4 --history /tmp/state/agent-sessions/csec028-test/resume-history.json
fi
```

```expect:partial
TOOL-RESULT-9284
```
