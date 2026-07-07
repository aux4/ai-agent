# human-in-the-loop parking (HARN-005)

Non-TTY human-in-the-loop for `aux4 ai agent ask`. When there is no TTY, the `askUser`
tool and permission `ask:` gates no longer silently auto-proceed (askUser) or silently
auto-deny (permission). Instead, in the default `humanInLoop: park` mode the agent
records a durable pending question in its history file, emits a structured
`AUX4_PENDING_QUESTION` marker for a supervisor, and ends the turn with exit code 10. On
the next run the pending question is resolved with the user's answer, fed back to the
waiting tool call, and the loop continues.

The tool and engine layers both call the shared, side-effect-free helpers in
`src/lib/HumanInLoop.js` (park signal encoding, the four-way ask-gate decision, parked
result detection, and resume feed). `Tools.js`/`Prompt.js` are not importable in plain
node (a transitive doc-loader dependency breaks at import), so this check drives those
shared helpers directly — no API key, no model, and no TTY required.

## parking record + resume-with-answer flow

### should encode/detect the pending record, gate on TTY/mode, and feed the answer back on resume

```execute
node human-in-loop-check.mjs
```

```expect:partial
HUMAN-IN-LOOP OK
```
