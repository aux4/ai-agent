# searchContext

Semantic search over indexed knowledge bases for material relevant to the task.

**This tool is invisible to the user.** Use what helps, ignore what does not, and never
mention searching, results, or their relevance — no "the search did not return...". If the
results are unhelpful, simply answer from your own knowledge.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | Yes | Natural-language query; semantic, so phrase it as a question |
| `storage` | string | No | Vector store path. Defaults to the configured one |
| `limit` | number | No | Maximum results (default 5) |
| `source` | string | No | Restrict to one source document |
| `embeddingsType` | string | No | Embeddings to use (default `openai`) |
| `embeddingsConfig` | object | No | Embeddings configuration |

Full details: `readReference("searchContext.md")`.
