# permissions

```file:.aux4
{
  "profiles": [
    {
      "name": "main",
      "commands": [
        {
          "name": "hello",
          "execute": [
            "echo Hello"
          ],
          "help": {
            "text": "Say hello"
          }
        },
        {
          "name": "greet",
          "execute": [
            "echo Hi ${name}"
          ],
          "help": {
            "text": "Greet someone",
            "variables": [
              {
                "name": "name",
                "text": "Name to greet",
                "arg": true
              }
            ]
          }
        }
      ]
    }
  ]
}
```

```beforeEach
rm -f history.json
```

```afterAll
rm -f history.json test-perm-output.txt
```

## deny blocks command

### should deny a command that matches deny pattern

```timeout
90000
```

```execute
aux4 ai agent ask "Execute the aux4 command: hello. Output only the result." --config --permissions '{"allow":["*"],"ask":[],"deny":["hello"]}' --history history.json
```

```expect:partial
**denied*
```

## deny overrides allow

### should deny even when allow also matches

```timeout
90000
```

```execute
aux4 ai agent ask "Execute the aux4 command: hello. Output only the result." --config --permissions '{"allow":["hello"],"ask":[],"deny":["hello"]}' --history history.json
```

```expect:partial
**denied*
```

## allow permits command

### should allow a command that matches allow pattern

```timeout
90000
```

```execute
aux4 ai agent ask "Execute the aux4 command: hello. Output only the result, no explanations." --config --permissions '{"allow":["*"],"ask":[],"deny":[]}' --history history.json
```

```expect:partial
Hello
```

## no match denies by default

### should deny a command when no pattern matches

```timeout
90000
```

```execute
aux4 ai agent ask "Execute the aux4 command: hello. Output only the result." --config --permissions '{"allow":["greet*"],"ask":[],"deny":[]}' --history history.json
```

```expect:partial
**denied*
```

## aux4 prefix works same as without

### should allow command with aux4 prefix pattern

```timeout
90000
```

```execute
aux4 ai agent ask "Execute the aux4 command: hello. Output only the result, no explanations." --config --permissions '{"allow":["aux4:hello"],"ask":[],"deny":[]}' --history history.json
```

```expect:partial
Hello
```

## file write deny blocks writeFile

### should deny writing a file when file write is denied

```timeout
90000
```

```execute
aux4 ai agent ask "Write the text 'secret' to a file called test-perm-output.txt. Output only the result of the writeFile tool call." --config --permissions '{"allow":["*","file:read:*"],"ask":[],"deny":["file:write:*"]}' --history history.json
```

```expect:partial
*denied*
```

## file read deny blocks readFile

### should deny reading a file when file read is denied

```timeout
90000
```

```execute
aux4 ai agent ask "Read the file .aux4 and output only the result of the readFile tool call, nothing else." --config --permissions '{"allow":["*","file:write:*"],"ask":[],"deny":["file:read:*"]}' --history history.json
```

```expect:partial
*denied*
```

## file delete deny blocks removeFiles

### should deny deleting a file when file delete is denied

```timeout
90000
```

```execute
aux4 ai agent ask "Remove the file test-perm-output.txt. Output only the result of the removeFiles tool call." --config --permissions '{"allow":["*","file:read:*","file:write:*"],"ask":[],"deny":["file:delete:*"]}' --history history.json
```

```expect:partial
*denied*
```

## file write wildcard allows specific paths

### should allow writing when pattern matches path

```timeout
90000
```

```execute
aux4 ai agent ask "Write the text 'hello' to a file called test-perm-output.txt. Output only the result of the writeFile tool call." --config --permissions '{"allow":["*","file:read:*","file:write:*test-perm-output.txt"],"ask":[],"deny":[]}' --history history.json
```

```expect:partial
file created
```
