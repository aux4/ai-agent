#### Description

Search queries over the agent's learned documents and return the most relevant matches from the local vector store. The command looks up the provided query in the specified storage directory, optionally filters by a source file path, and returns up to the requested number of results. Output can be returned as plain text (default) or as JSON for programmatic consumption. If no documents have been indexed yet the command returns an error asking you to add documents using the learn command.

#### Usage

Describe the main parameters and options of the command.

```bash
aux4 ai agent search [--storage <path>] [--format <text|json>] [--source <file-path>] [--limit <n>] <query>
```

- storage: The storage directory containing the vector store (default: .context).
- format: Output format, either text (default) or json.
- source: Optional source file path to limit results to a specific document.
- limit: Number of results to return (default: 1).
- query: The search query (can be provided as a positional argument).

#### Example

Search the local vector store for a question about John Doe and return a text result. This assumes documents have already been indexed with the learn command.

```bash
aux4 ai agent search "who is john doe?"
```

This runs a vector search for the query and prints the best-matching document text. Example output:

```text
John Doe is a software engineer at Acme Corp.
```

Example returning JSON with up to 3 results:

```bash
aux4 ai agent search --format json --limit 3 "capital of France"
```

This returns a JSON array with up to three matching entries (document text and metadata) which can be consumed by other tools or scripts.