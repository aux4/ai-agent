# aux4/ai-agent

AI agent with document learning, vector search, and conversational AI.

## Install

```bash
aux4 aux4 pkger install aux4/ai-agent
```

## Commands

### Learn

Index a document or folder for semantic search. Files are tracked by MD5 hash — unchanged files are automatically skipped on re-learn.

```bash
aux4 ai agent learn <doc>           # Learn a file
aux4 ai agent learn ./docs/         # Learn all files in a folder
aux4 ai agent learn doc.txt --storage .context
```

Supported file types: `.md`, `.txt`, `.pdf`, `.json`, `.csv`, `.docx`, `.pptx`

### Search

```bash
aux4 ai agent search "query"
aux4 ai agent search --format json --limit 3 "query"
```

### Forget

```bash
aux4 ai agent forget                # Forget all documents
aux4 ai agent forget doc.txt        # Forget a specific file
aux4 ai agent forget ./docs/        # Forget all files from a folder
```

### Ask

```bash
aux4 ai agent ask "What is X?"
aux4 ai agent ask --stream true "Explain Y"
```

### Chat

```bash
aux4 ai agent chat "Hello"
```

### Image

```bash
aux4 ai agent image "A sunset over mountains" --image output.png
```

## Storage

Learned documents are stored in `.context/` by default. Use `--storage <dir>` to customize.
