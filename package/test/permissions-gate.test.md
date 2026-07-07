# permission gate (keyless)

These tests exercise the real tool-permission gate — the same `createTools` /
`checkPermission` / `checkFileAccess` path a live model drives — **without any LLM
credentials**. The OpenAI provider is pointed at a local mock server (dummy key +
`configuration.baseURL` on `127.0.0.1`) that requests one specific tool based on a
sentinel in the prompt, then echoes the tool's result back as the final answer so the
permission decision is observable in stdout.

They protect the allow/ask/deny semantics for commands and `file:read|write|delete:*`,
the hard system-deny on `secret get`, and path-bounding — so a refactor of `Tools.js`
that unifies the permissioned/non-permissioned tool variants can be proven
behavior-preserving.

```file:mock-openai-perm.mjs
import http from "node:http";

const port = parseInt(process.argv[2] || "8743", 10);

function toolCall(name, args) {
  return {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: "call_" + Math.random().toString(36).slice(2, 8),
        type: "function",
        function: { name, arguments: JSON.stringify(args) }
      }
    ]
  };
}

http.createServer((req, res) => {
  let body = "";
  req.on("data", chunk => (body += chunk));
  req.on("end", () => {
    let parsed = {};
    try { parsed = JSON.parse(body); } catch {}
    const messages = parsed.messages || [];
    const lastTool = [...messages].reverse().find(m => m.role === "tool");

    let message;
    if (lastTool) {
      const content = typeof lastTool.content === "string" ? lastTool.content : JSON.stringify(lastTool.content);
      message = { role: "assistant", content: "RESULT: " + content };
    } else {
      const has = s => body.includes(s);
      if (has("EXECDENY")) {
        message = toolCall("executeAux4", { command: "hello" });
      } else if (has("SECRETGET")) {
        message = toolCall("executeAux4", { command: "secret get vault/item/field" });
      } else if (has("WRITEDENY") || has("WRITEALLOW")) {
        message = toolCall("writeFile", { file: "perm-out.txt", content: "hello" });
      } else if (has("READDENY")) {
        message = toolCall("readFile", { file: "perm-probe.txt" });
      } else if (has("DELDENY")) {
        message = toolCall("removeFiles", { files: "perm-out.txt" });
      } else {
        message = { role: "assistant", content: "no-op" };
      }
    }

    const payload = {
      id: "chatcmpl-mock",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "gpt-4o-mini",
      choices: [{ index: 0, message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  });
}).listen(port, "127.0.0.1", () => process.stderr.write(`mock-openai-perm on ${port}\n`));
```

```file:model.json
{
  "type": "openai",
  "config": {
    "model": "gpt-4o-mini",
    "apiKey": "sk-test",
    "maxRetries": 0,
    "configuration": {
      "baseURL": "http://127.0.0.1:8743/v1"
    }
  }
}
```

## gate

```afterAll
pkill -f "mock-openai-perm.mjs" || true
rm -f perm-out.txt perm-hist.json
```

### should start the mock model server

```execute
nohup node mock-openai-perm.mjs 8743 >/dev/null 2>&1 &
sleep 1
curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:8743/v1/chat/completions -d '{}'
```

```expect
200
```

### should deny an executeAux4 command that matches the deny list

```timeout
30000
```

```execute
rm -f perm-hist.json
aux4 ai agent ask --model "$(cat model.json)" --history perm-hist.json --permissions '{"allow":["*"],"ask":[],"deny":["hello"]}' "EXECDENY run it" 2>/dev/null
```

```expect:partial
Permission denied: command "hello" is not allowed
```

### should deny an executeAux4 command when no allow pattern matches

```timeout
30000
```

```execute
rm -f perm-hist.json
aux4 ai agent ask --model "$(cat model.json)" --history perm-hist.json --permissions '{"allow":["greet*"],"ask":[],"deny":[]}' "EXECDENY run it" 2>/dev/null
```

```expect:partial
Permission denied: command "hello" is not allowed
```

### should block secret get via the system deny list even when allow is wildcard

```timeout
30000
```

```execute
rm -f perm-hist.json
aux4 ai agent ask --model "$(cat model.json)" --history perm-hist.json --permissions '{"allow":["*"],"ask":[],"deny":[]}' "SECRETGET please" 2>/dev/null
```

```expect:partial
blocked by system security policy
```

### should deny writeFile when file write is denied

```timeout
30000
```

```execute
rm -f perm-hist.json perm-out.txt
aux4 ai agent ask --model "$(cat model.json)" --history perm-hist.json --permissions '{"allow":["*","file:read:*"],"ask":[],"deny":["file:write:*"]}' "WRITEDENY now" 2>/dev/null
```

```expect:partial
Permission denied: write
```

### should allow writeFile when the file write pattern matches the path

```timeout
30000
```

```execute
rm -f perm-hist.json perm-out.txt
aux4 ai agent ask --model "$(cat model.json)" --history perm-hist.json --permissions '{"allow":["*","file:read:*","file:write:*perm-out.txt"],"ask":[],"deny":[]}' "WRITEALLOW now" 2>/dev/null
```

```expect:partial
file created
```

### should deny readFile when file read is denied

```timeout
30000
```

```execute
rm -f perm-hist.json
aux4 ai agent ask --model "$(cat model.json)" --history perm-hist.json --permissions '{"allow":["*","file:write:*"],"ask":[],"deny":["file:read:*"]}' "READDENY now" 2>/dev/null
```

```expect:partial
Permission denied: read
```

### should deny removeFiles when file delete is denied

```timeout
30000
```

```execute
rm -f perm-hist.json
aux4 ai agent ask --model "$(cat model.json)" --history perm-hist.json --permissions '{"allow":["*","file:read:*","file:write:*"],"ask":[],"deny":["file:delete:*"]}' "DELDENY now" 2>/dev/null
```

```expect:partial
Permission denied: delete
```
