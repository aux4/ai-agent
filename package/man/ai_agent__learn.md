#### Description

The learn command ingests a document or folder into the AI agent's persistent storage so the agent can later search and answer questions based on that content. You pass the path to a file or directory as a positional argument; the command processes and stores the content (text, embeddings and metadata) under the specified storage directory.

When a folder is provided, the command recursively walks the directory and indexes all supported files (`.md`, `.txt`, `.pdf`, `.json`, `.csv`, `.docx`, `.pptx`). Subdirectories starting with `.` are excluded.

Files are tracked by MD5 hash. Re-learning an unchanged file is automatically skipped. If the file content has changed, the old embeddings are replaced with new ones.

#### Usage

The command accepts a positional document/folder argument and two optional parameters: storage (the directory where learned data is kept) and type (an optional label describing the document's kind).

```bash
aux4 ai agent learn <doc> --storage <dir> --type <type>
```

- <doc> (positional): Path to the document file or folder to learn from.
- --storage: Directory used for storing the agent's learned data (default: .context).
- --type: Optional string to classify the document (default: empty).

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
