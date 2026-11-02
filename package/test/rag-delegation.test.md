# RAG commands are supplied by ai-rag

The public command names remain under `aux4 ai agent`. The ai-agent package
depends on ai-rag, which owns the command implementation.

```execute
aux4 ai agent --help
```

```expect:partial
learn
search
forget
```

## Option-looking text stays a search query

```execute
aux4 ai agent search --storage .context-option-query --format json --query=--help
```

```error
No documents have been indexed yet. Please use 'aux4 ai agent learn <document>' to add documents to the vector store first.
```

## Default references directory contains the searchContext instructions

```execute
test -f ../references/searchContext.md && echo "searchContext reference available"
```

```expect
searchContext reference available
```
