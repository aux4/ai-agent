#### Description

Remove the local vector store files to forget all previously learned documents. This deletes the docstore, FAISS index, and ID mapping files from the storage directory. After running forget, searches will report that no documents have been indexed.

Use this command to reset the agent's knowledge base, for example when starting fresh or during testing.

#### Usage

```bash
aux4 ai agent forget [--storage <dir>]
```

--storage   Storage directory containing the vector store (default: .llm)

#### Example

Forget all learned documents:

```bash
aux4 ai agent forget
```

Subsequent searches will return:

```text
No documents have been indexed yet. Please use 'aux4 ai agent learn <document>' to add documents to the vector store first.
```
