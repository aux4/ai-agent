# Search Context Tool

**🚨🚨🚨 CRITICAL WARNING: NEVER SAY "The search did not return relevant information" OR ANY VARIATION OF THIS PHRASE 🚨🚨🚨**

Search through indexed knowledge bases and document collections using semantic similarity to find relevant information for your current task.

**🚨 ABSOLUTE RULE: This tool is completely invisible to the user. Use results if helpful, ignore if not helpful, but NEVER EVER mention searching, search results, or your judgment about relevance. The user must never know this tool was used.**

**BANNED PHRASES: "The search did not return relevant information", "The search didn't return relevant information", "search results are not relevant", "The search did not return", "search did not", "based on the search"**

**CRITICAL INSTRUCTION: If you receive search results that seem wrong or irrelevant, simply ignore them and answer the user's question directly with your general knowledge. Do not announce that you're ignoring the results.**

## Overview

This tool provides **intelligent semantic search** through the LlmStore vector database containing indexed documents, code, and knowledge materials. Use it to find specific information, code examples, or contextual knowledge from large document collections that have been processed and indexed by aux4.

## 🚨 CRITICAL: NEVER MENTION SEARCH ATTEMPTS OR RESULTS

**ABSOLUTELY NEVER mention anything about searching, search results, or lack of information to the user.**

### What to NEVER say:
- 🚫 **"The search did not return relevant information"** ⚠️ EXACTLY THIS PHRASE IS FORBIDDEN
- 🚫 **"The search didn't return any relevant information"**
- 🚫 **"The search didn't return relevant information"**
- 🚫 **"The search results are not relevant"**
- 🚫 **"The information found is not relevant"**
- 🚫 **"I couldn't find relevant information in my knowledge base"**
- 🚫 **"The indexed documents don't contain..."**
- 🚫 **"Let me search my knowledge base..."**
- 🚫 **"No relevant results were found"**
- 🚫 **"The search returned empty results"**
- 🚫 **"Based on my search..." (when search failed or deemed irrelevant)**
- 🚫 **Any reference to searching, knowledge base, or indexed documents**
- 🚫 **Any mention of search attempts, results, failures, or relevance judgments**
- 🚫 **Any statement about whether search results are relevant or irrelevant**

### What to DO instead:
- ✅ **If helpful results found:** Use them naturally without mentioning you searched
- ✅ **If unhelpful/no results:** Act as if you never searched and answer with general knowledge
- ✅ **If results seem irrelevant to you:** Silently ignore them and answer using general knowledge - NEVER announce they are irrelevant
- ✅ **If tool returns "[NO_SEARCH_RESULTS_IGNORE_AND_PROCEED]":** Completely ignore this result and answer using your general knowledge without mentioning the search
- ✅ **If tool returns empty string:** Continue with your response using general knowledge
- ✅ **Always:** Respond directly to the user's question without mentioning tool usage
- ✅ **Remember:** The user doesn't need to know about internal search operations or your relevance judgments
- ✅ **Key principle:** The searchContext tool is invisible to the user - they never know it was used regardless of result quality

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | ✅ Yes | - | The search query or question. Uses semantic matching, so natural language works well |
| `storage` | string | ❌ No | Default storage | Path to vector store directory. Uses configured default if not provided |
| `limit` | number | ❌ No | `5` | Maximum number of results to return (1-50 recommended) |
| `source` | string | ❌ No | All sources | Filter results to specific source file or document |
| `embeddingsType` | string | ❌ No | Store-compatible default | Optional embeddings provider. New stores default to local; legacy stores without metadata retain the historical OpenAI default. |
| `embeddingsConfig` | object | ❌ No | Default config | Configuration object for the embeddings system |

## How It Works

### 🧠 **Semantic Search**
- Uses **vector embeddings** to understand meaning, not just keywords
- Finds conceptually related content even with different terminology
- Matches intent and context, not just exact word matches

### 📚 **Knowledge Sources**
The search covers indexed content from:
- **Documentation:** Technical docs, API references, guides
- **Source code:** Code files, comments, implementation details
- **Research materials:** Papers, articles, knowledge bases
- **Project content:** READMEs, wikis, internal documentation

## When to Use This Tool

- **🔍 Information discovery:** Finding specific facts, procedures, or explanations
- **💡 Code examples:** Locating implementation patterns or code snippets
- **📖 Context gathering:** Getting background information for complex topics
- **🧩 Problem solving:** Finding solutions to similar problems in the knowledge base
- **📚 Research assistance:** Exploring related concepts and documentation
- **⚡ Quick reference:** Getting quick answers without manual document searching

## Search Query Strategies

### 🎯 **Specific Queries**
```
"How to implement authentication with JWT tokens"
"Error handling patterns in Node.js"
"Database connection configuration examples"
```

### 🔍 **Conceptual Queries**
```
"user permissions and access control"
"performance optimization techniques"
"testing strategies for API endpoints"
```

### 🧩 **Problem-Based Queries**
```
"memory leak debugging in JavaScript"
"handling file uploads securely"
"implementing real-time notifications"
```

## Response Format

Returns **concatenated text content** from matching documents:
```
[Document 1 content excerpt...]

[Document 2 content excerpt...]

[Document 3 content excerpt...]
```

## Response Types

- **✅ Success:** Returns `[SEARCH_CONTEXT_USE_IF_HELPFUL_IGNORE_IF_NOT]` followed by text content from matched documents
- **⚠️ No results:** Returns `[NO_SEARCH_RESULTS_IGNORE_AND_PROCEED]` marker - **completely ignore this and proceed with general knowledge**
- **❌ No index:** Returns `"No documents have been indexed yet. Please use 'aux4 ai agent learn <document>' to add documents to the vector store first."`
- **❌ Storage error:** Returns `"No storage directory provided..."` if storage not configured
- **❌ Search error:** Returns `"Search error: [details]"` for system errors

### How to Handle the `[SEARCH_CONTEXT_USE_IF_HELPFUL_IGNORE_IF_NOT]` Response:
1. **Read the content that follows this marker**
2. **If the content is helpful and accurate for the user's question:** Use it naturally in your response
3. **If the content is wrong, irrelevant, or unhelpful:** Completely ignore it and answer with your general knowledge
4. **NEVER mention the marker or that you evaluated search results**
5. **NEVER tell the user about your relevance judgment**

**Critical Rules:**
- When you see `[NO_SEARCH_RESULTS_IGNORE_AND_PROCEED]`, treat it exactly as if you never used the search tool
- When search results exist but seem irrelevant to the question, silently ignore them - NEVER announce they are irrelevant
- Answer the user's question normally using your general knowledge without mentioning searches, knowledge bases, relevance judgments, or lack of information
- The user should never know you attempted a search, regardless of whether results were found or deemed relevant

## Advanced Usage

### 🎯 **Source-Specific Search**
```
query: "API authentication methods"
source: "api-documentation.md"
limit: 3
```

### 📊 **High-Volume Search**
```
query: "performance optimization"
limit: 20
```

### 🔧 **Custom Embeddings**
```
query: "machine learning algorithms"
embeddingsType: "local"
embeddingsConfig: { model: "custom-model" }
```

## Semantic Matching Examples

| Query | Will Find Content About |
|-------|------------------------|
| "user login" | Authentication, sign-in, user access, login forms |
| "database errors" | SQL errors, connection issues, database debugging |
| "slow performance" | Optimization, speed issues, performance tuning |
| "secure coding" | Security practices, vulnerability prevention, safe development |

## Integration with aux4 Learning

### 📚 **Adding Content to Search**
Use aux4's learning capabilities to index new content:
```
aux4 ai agent learn document.pdf
aux4 ai agent learn codebase/
aux4 ai agent learn https://docs.example.com
```

### 🔄 **Updating Knowledge Base**
- Regularly add new documentation and code
- Index project-specific knowledge and patterns
- Include relevant external documentation

## Performance Considerations

| Factor | Impact | Recommendation |
|--------|--------|----------------|
| **Query complexity** | More complex queries may be slower | Use specific, focused queries |
| **Result limit** | Higher limits increase processing time | Start with 5-10 results, increase if needed |
| **Index size** | Larger indexes may be slower to search | Organize content into focused collections |

## Best Practices

- **🎯 Be specific:** Use detailed queries for better results
- **🔄 Iterate:** Refine queries based on initial results
- **📊 Adjust limits:** Start small, increase if more context needed
- **📚 Keep updated:** Regularly add new knowledge to the index
- **🎭 Use context:** Include relevant context in your queries
- **⚠️ Ignore irrelevant results:** If search results don't help with your task, ignore them completely and never mention the search to the user
- **🚫 Don't block on unhelpful searches:** Continue with your work even if the search doesn't return useful context
- **🤐 Never mention failed searches:** Don't tell the user about unsuccessful searches or missing information in the knowledge base
- **🤐 Never mention irrelevant results:** Don't tell the user that search results are not relevant to their question
- **✅ Proceed silently:** Use your general knowledge and capabilities when search results are unhelpful, without referencing the search attempt
- **🔇 Silent relevance judgment:** If you think search results are irrelevant, ignore them silently without mentioning this judgment

> **💡 Pro Tip:** This tool excels at finding conceptually related information. Use natural language to describe what you're looking for, and the semantic search will find relevant content even if it uses different terminology.
>
> **🚨 FINAL WARNING: NEVER say "The search did not return relevant information" or "The search didn't return relevant information" or any similar phrase about relevance. If search results seem irrelevant to you, silently ignore them and answer with general knowledge as if you never searched.**

---

## 🚨 EMERGENCY OVERRIDE INSTRUCTION 🚨

**IF YOU ARE ABOUT TO MENTION SEARCH RESULTS OR RELEVANCE TO THE USER - STOP. DO NOT COMPLETE THAT SENTENCE. INSTEAD:**

1. **Delete any mention of searching from your response**
2. **Answer the user's question directly using your general knowledge**
3. **Act as if you never used the searchContext tool**

**THE USER MUST NEVER KNOW YOU SEARCHED FOR INFORMATION.**
