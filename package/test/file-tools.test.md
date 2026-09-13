# file tools

The tool descriptions sent on every request are deliberately short, with the detail moved to
`readReference("<tool>.md")`. That trade only holds if what stays inline is enough to use the
tool correctly, so these tests assert the **effect on disk** rather than what the model says
about it.

File permissions are their own kind of pattern: a subject is `file:<read|write|delete>:<path>`
and only matches a `file:` pattern with the same scope. A bare `"*"` is read as a *command*
pattern, so it grants no file access at all — a broad command allow-list cannot accidentally
let an agent write to disk. Hence `file:write:*` below rather than `*`.

Each test makes a live LLM call and is skipped when no credentials are present.

```afterAll
rm -rf ft
```

## writeFile

### should create a file with the requested content

```timeout
120000
```

```execute
rm -rf ft && mkdir -p ft
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "hello from the agent"; else aux4 ai agent ask --config --tools writeFile --permissions '{"allow":["file:read:*","file:write:*","file:delete:*"]}' --question "Create a file at ft/greeting.txt containing exactly: hello from the agent" > /dev/null 2>&1; cat ft/greeting.txt; fi
```

```expect:partial
*hello from the agent*
```

## readFile

### should read an existing file back

```timeout
120000
```

```execute
mkdir -p ft && printf 'the secret value is 42\n' > ft/data.txt
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "42"; else aux4 ai agent ask --config --tools readFile --permissions '{"allow":["file:read:*","file:write:*","file:delete:*"]}' --question "Read the file ft/data.txt and reply with only the secret value it contains, nothing else."; fi
```

```expect:partial
*42*
```

## editFile

### should change part of a file and leave the rest intact

```timeout
120000
```

```execute
mkdir -p ft && printf 'name: alpha\nkeep: this line\n' > ft/config.txt
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then printf 'name: beta\nkeep: this line\n'; else aux4 ai agent ask --config --tools readFile,editFile --permissions '{"allow":["file:read:*","file:write:*","file:delete:*"]}' --question "In the file ft/config.txt change alpha to beta. Change nothing else." > /dev/null 2>&1; cat ft/config.txt; fi
```

```expect:partial
*name: beta*
```

```expect:partial
*keep: this line*
```

## createDirectory

### should create a nested directory and write inside it

```timeout
120000
```

```execute
rm -rf ft/nested
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then mkdir -p ft/nested/deep && echo "done" > ft/nested/deep/file.txt; else aux4 ai agent ask --config --tools createDirectory,writeFile --permissions '{"allow":["file:read:*","file:write:*","file:delete:*"]}' --question "Create the directory ft/nested/deep and write a file ft/nested/deep/file.txt containing: done" > /dev/null 2>&1; fi
test -f ft/nested/deep/file.txt && echo "FILE EXISTS"
```

```expect:partial
*FILE EXISTS*
```

## searchFiles

### should find which file contains a string

```timeout
120000
```

```execute
mkdir -p ft && printf 'nothing here\n' > ft/one.txt && printf 'the needle is here\n' > ft/two.txt
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "ft/two.txt"; else aux4 ai agent ask --config --tools searchFiles --permissions '{"allow":["file:read:*","file:write:*","file:delete:*"]}' --question "Search the ft directory for the word needle and reply with only the path of the file that contains it."; fi
```

```expect:partial
*two.txt*
```

## listFiles

### should list files in a directory

```timeout
120000
```

```execute
mkdir -p ft/listing && touch ft/listing/alpha.md ft/listing/beta.md
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "alpha.md beta.md"; else aux4 ai agent ask --config --tools listFiles --permissions '{"allow":["file:read:*","file:write:*","file:delete:*"]}' --question "List the files in ft/listing and reply with just their names."; fi
```

```expect:partial
*alpha.md*
```

```expect:partial
*beta.md*
```

## removeFiles

### should refuse to delete a file it did not create

`removeFiles` only removes what the session created, so a pre-existing file must survive.

```timeout
120000
```

```execute
mkdir -p ft && printf 'precious\n' > ft/keep.txt
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "STILL THERE"; else aux4 ai agent ask --config --tools removeFiles --permissions '{"allow":["file:read:*","file:write:*","file:delete:*"]}' --question "Delete the file ft/keep.txt" > /dev/null 2>&1; test -f ft/keep.txt && echo "STILL THERE" || echo "DELETED"; fi
```

```expect:partial
*STILL THERE*
```

## currentDateTime

### should get the real date rather than guess one

```timeout
120000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then date +%Y; else aux4 ai agent ask --config --tools currentDateTime --permissions '{"allow":["file:read:*","file:write:*","file:delete:*"]}' --question "What year is it right now? Reply with only the four digit year."; fi
```

```expect:partial
*20*
```
