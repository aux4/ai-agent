# RAG

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
aux4 ai agent learn content.txt
```

### Search when there is content

```execute
aux4 ai agent search "who is john doe?"
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
aux4 ai agent learn folder-a/
```

```execute
aux4 ai agent learn folder-b/
```

### Verify both are searchable

```execute
aux4 ai agent search "Where does Alice work?"
```

```expect
Alice works at Alpha Inc.
```

```execute
aux4 ai agent search "Where does Bob work?"
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
aux4 ai agent search "Where does Bob work?"
```

```expect
Bob works at Beta Corp.
```
