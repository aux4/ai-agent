# RAG commands are supplied by ai-rag

The public command names remain under `aux4 ai agent`. The ai-agent package
depends on ai-rag, which owns the command implementation.

```execute
aux4 ai agent --help
```

```expect:partial
  learn
```

```expect:partial
  search
```

```expect:partial
  forget
```

## searchContext forwards an option-looking query as --query=<value>

The searchContext tool builds its `aux4 ai agent search` invocation with
`--query=<value>` rather than a bare positional, so a query that happens to
look like a flag (e.g. "--help") is not misparsed by aux4 itself.

```execute
aux4 ai agent search --storage .context-option-query --format json --query=--help
```

```error
No documents have been indexed yet. Please use 'aux4 ai agent learn <document>' to add documents to the vector store first.
```
