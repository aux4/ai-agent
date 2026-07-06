# message-format (de)serialization (HARN-008)

The agent persists a conversation as a plain JSON history file and, on every turn,
converts that stored JSON back into the LangChain message objects the model expects —
and converts the model's responses (an `AIMessage` carrying `tool_calls`, plus tool
results) back into the stored JSON shape. That round-trip is the most format-fragile
part of the engine.

These tests are deterministic and need **no LLM credentials**. The pure
(de)serialization functions live in `src/lib/MessageFormat.js` (extracted from
`Prompt.js`, which cannot be imported in plain node because a transitive doc-loader
dependency throws at import). The check script drives those functions directly — no
API key, no model — asserting round-trip fidelity for:

- `assistant_with_tool` — a live `AIMessage` with `tool_calls` is stored, written to
  disk (JSON) and reloaded, and the reconstructed message keeps its `tool_call` ids,
  names, args, text content and `additional_kwargs` (both the in-memory and the
  serialized-`kwargs` deserialization branches).
- tool results — the flat `{ role, content, tool_call_id, name }` entry and the two
  legacy shapes (serialized `kwargs`, nested `content.content`), including preserved
  `image_url` content and recorded `policy` decisions.
- the full persistence path — transient (untimestamped) system instructions are
  dropped from the saved file, a timestamped system message is kept, and message order
  is preserved (`simplifyMessagesForHistory`).
- `collapseSystemMessages` — all system messages merge into one leading message.
- `saveImage` base64-truncation recovery — a truncated `saveImage` argument is
  repaired from a prior tool message's full base64, well-formed data is untouched, and
  unrecoverable / non-`saveImage` / malformed cases are handled without corruption.

## round-trip fidelity, recovery, and assembly

### should preserve message structure through serialize -> save -> load -> deserialize

```execute
node message-format-check.mjs 2>/dev/null | tail -1
```

```expect
MESSAGE-FORMAT OK
```
