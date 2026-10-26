#### Description

The learn command ingests a document or folder into the AI agent's persistent storage so the agent can later search and answer questions based on that content. You pass the path to a file or directory as a positional argument; the command processes and stores the content (text, embeddings and metadata) under the specified storage directory.

When a folder is provided, the command recursively walks the directory and indexes all supported files (`.md`, `.txt`, `.pdf`, `.json`, `.csv`, `.docx`, `.pptx`). Subdirectories starting with `.` are excluded.

Files are tracked by MD5 hash. Re-learning an unchanged file is automatically skipped. If the file content has changed, the old embeddings are replaced with new ones.

Embeddings are computed by one of several pluggable providers, selected with `--embeddings`:

- **local** (default) — runs fully offline via `aux4/embedding` (Google's EmbeddingGemma 2, CPU). No API key, no network after the model is cached.
- **openai**, **bedrock**, **cohere**, **databricks**, **mistral**, **ollama**, **vertex** — API-backed providers, each with their own credential/config requirements.

A store remembers which embeddings configuration it was built with. Learning into a store with a *different* type or config than it was originally built with fails with a clear error telling you to `forget` and re-learn — mixing embeddings from different models in the same store produces incompatible, meaningless vectors.

#### Usage

The command accepts a positional document/folder argument and optional parameters: storage (the directory where learned data is kept), type (an optional label describing the document's kind), and embeddings (which embeddings provider/config to use).

```bash
aux4 ai agent learn <doc> --storage <dir> --type <type> --embeddings <json>
```

- <doc> (positional): Path to the document file or folder to learn from.
- --storage: Directory used for storing the agent's learned data (default: .context).
- --type: Optional string to classify the document (default: empty).
- --embeddings: Embeddings configuration as JSON, `{"type": "...", "config": {...}}` (default: `{}`, which resolves to type `local`).

#### Example

Learn a file named france.txt and then query the agent for the capital of France.

```bash
aux4 ai agent learn france.txt
aux4 ai agent search "What is the capital of France?"
```

This runs the learn command which ingests and indexes france.txt into the agent's storage (by default .context). The subsequent search asks the agent about the capital of France and returns the learned answer.

```text
Capital of France is Paris
```

Learn an entire folder:

```bash
aux4 ai agent learn ./docs/
```

Re-learning unchanged files prints a skip message:

```text
Skipped (unchanged): /path/to/docs/file.md
```

Learn using OpenAI embeddings instead of the default `local` type:

```bash
aux4 ai agent learn france.txt --embeddings '{"type":"openai","config":{"model":"text-embedding-3-small"}}'
```

Learning into an existing store with a different embeddings configuration fails instead of silently corrupting the store:

```text
Embeddings mismatch: the store at '.context' was indexed with embeddings type 'local', but the
current configuration uses type 'openai'. Mixing embeddings from different models/configs in the
same store produces incompatible vectors. Run 'aux4 ai agent forget --storage .context' to clear
the store, then re-run 'aux4 ai agent learn --storage .context' with the new embeddings
configuration.
```
