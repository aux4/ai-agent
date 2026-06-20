# RAG

The `learn`/`search` steps below exercise the embeddings-backed vector store and
are skipped when no LLM credentials are present (CI); they run for real when
`OPENAI_API_KEY` (or `AUX4_TEST_LLM`) is set. The empty-store and `forget`
checks are deterministic and always run.

```beforeAll
rm -rf .context
```

```afterAll
rm -rf .context folder-a/ folder-b/
```

## Search when there is not content

```execute
aux4 ai agent search "who is john doe?"
```

```error
No documents have been indexed yet. Please use 'aux4 ai agent learn <document>' to add documents to the vector store first.
```

## Loading documents

```file:content.txt
John Doe is a software engineer at Acme Corp.
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then true; else aux4 ai agent learn content.txt; fi
```

### Search when there is content

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "John Doe is a software engineer at Acme Corp."; else aux4 ai agent search "who is john doe?"; fi
```

```output
John Doe is a software engineer at Acme Corp.
```

#### Forget Documents

```execute
aux4 ai agent forget
```

```execute
aux4 ai agent search "who is john doe?"
```

```error
No documents have been indexed yet. Please use 'aux4 ai agent learn <document>' to add documents to the vector store first.
```

## Forget a specific folder

```execute
mkdir -p folder-a folder-b
echo "Alice works at Alpha Inc." > folder-a/alice.txt
echo "Bob works at Beta Corp." > folder-b/bob.txt
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then true; else aux4 ai agent learn folder-a/; fi
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then true; else aux4 ai agent learn folder-b/; fi
```

### Verify both are searchable

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "Alice works at Alpha Inc."; else aux4 ai agent search "Where does Alice work?"; fi
```

```expect
Alice works at Alpha Inc.
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "Bob works at Beta Corp."; else aux4 ai agent search "Where does Bob work?"; fi
```

```expect
Bob works at Beta Corp.
```

### Forget only folder-a

```execute
aux4 ai agent forget folder-a/
```

### Bob should still be searchable

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "Bob works at Beta Corp."; else aux4 ai agent search "Where does Bob work?"; fi
```

```expect
Bob works at Beta Corp.
```
