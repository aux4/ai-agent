# local embeddings

These tests exercise the `local` embeddings type end-to-end without any network access or API
key: `AUX4_LOCAL_EMBEDDINGS_COMMAND` overrides the command `LocalEmbeddings` shells out to, so a
tiny deterministic fake script stands in for `aux4 embedding embed`. The fake reads the same JSON
array from stdin and returns a one-hot-ish vector per item based on a fixed keyword list, which is
enough to prove: `local` is the default type, embeddings reach the CLI (`learn`/`search`/`forget`)
correctly, and the store guard blocks a mismatched embeddings configuration.

```file:fake-embed.cjs
let input = "";
process.stdin.on("data", chunk => { input += chunk; });
process.stdin.on("end", () => {
  const items = JSON.parse(input);
  const KEYWORDS = ["france", "paris", "london", "spain", "madrid", "alice", "alpha", "bob", "beta"];
  const vectors = items.map(item => {
    const text = (typeof item === "string" ? item : (item.text || "")).toLowerCase();
    return KEYWORDS.map(keyword => text.includes(keyword) ? 1 : 0);
  });
  process.stdout.write(JSON.stringify(vectors));
});
```

```beforeAll
rm -rf .context
```

```afterAll
rm -rf .context
```

## local is the default embeddings type

```execute
echo "Capital of France is Paris" > france.txt
AUX4_LOCAL_EMBEDDINGS_COMMAND="node fake-embed.cjs" aux4 ai agent learn france.txt
```

### the store records type "local" without any --embeddings flag

```execute
cat .context/ids.json
```

```expect:partial
"__embeddingsMeta__":{"type":"local"
```

## search routes through the same default and returns the right document

```execute
echo "Alice works at Alpha Inc." > alice.txt
AUX4_LOCAL_EMBEDDINGS_COMMAND="node fake-embed.cjs" aux4 ai agent learn alice.txt
```

```execute
AUX4_LOCAL_EMBEDDINGS_COMMAND="node fake-embed.cjs" aux4 ai agent search "Where does Alice work?"
```

```expect
Alice works at Alpha Inc.
```

```execute
AUX4_LOCAL_EMBEDDINGS_COMMAND="node fake-embed.cjs" aux4 ai agent search "What is the capital of France?"
```

```expect
Capital of France is Paris
```

## embeddings guard blocks a mismatched configuration

### search with a different embeddings config than the store was learned with fails clearly

```execute
AUX4_LOCAL_EMBEDDINGS_COMMAND="node fake-embed.cjs" aux4 ai agent search --embeddings '{"type":"local","config":{"dimension":256}}' "Where does Alice work?"
```

```error:partial
Embeddings mismatch: the store at '.context' was indexed with embeddings type 'local', but the current configuration uses type 'local' (dimension 256)
```

### learn with a different embeddings config than the store was learned with fails clearly

```execute
echo "Bob works at Beta Corp." > bob.txt
AUX4_LOCAL_EMBEDDINGS_COMMAND="node fake-embed.cjs" aux4 ai agent learn --embeddings '{"type":"local","config":{"dimension":256}}' bob.txt
```

```error:partial
Embeddings mismatch: the store at '.context' was indexed with embeddings type 'local'
```

### forgetting the whole store then re-learning with the new config succeeds

```execute
aux4 ai agent forget
AUX4_LOCAL_EMBEDDINGS_COMMAND="node fake-embed.cjs" aux4 ai agent learn --embeddings '{"type":"local","config":{"dimension":256}}' bob.txt
cat .context/ids.json
```

```expect:partial
"__embeddingsMeta__":{"type":"local","dimension":256
```
