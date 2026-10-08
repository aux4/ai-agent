#### Description

Remove learned documents from the vector store. When called without arguments, deletes all store files (docstore, FAISS index, and ID mapping) to forget everything. When given a file or folder path, selectively removes only the embeddings for that file or all files under that folder, preserving the rest of the store.

Use this command to reset the agent's knowledge base or to selectively remove specific documents.

When forgetting a specific `<doc>` (not the whole store), `--embeddings` must match whatever configuration the store was learned with — the command needs to load the existing store to remove only that document's vectors. Forgetting everything (no `<doc>`) just deletes the store files, so `--embeddings` isn't needed and is ignored.

#### Usage

```bash
aux4 ai agent forget [<doc>] [--storage <dir>] [--embeddings <json>]
```

- doc (positional, optional): File or folder path to forget. If omitted, forgets all documents.
- --storage: Storage directory containing the vector store (default: .context).
- --embeddings: Embeddings configuration as JSON, `{"type": "...", "config": {...}}` (default: `{}`, which resolves to type `local`). Only needed/checked when forgetting a specific doc.

#### Example

Forget all learned documents:

```bash
aux4 ai agent forget
```

Forget a specific file:

```bash
aux4 ai agent forget notes.txt
```

Forget all files learned from a folder:

```bash
aux4 ai agent forget ./docs/
```

Subsequent searches for forgotten content will no longer return results.
