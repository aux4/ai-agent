// Message-format (de)serialization for the agent history.
//
// The agent persists its conversation as a plain JSON history file and, on every
// turn, must turn that stored JSON back into the LangChain message objects the model
// expects — and turn the model's responses (AIMessage with tool_calls, tool results)
// back into the stored JSON shape. That round-trip is the most format-fragile part of
// the engine, so it lives here as small, pure functions with NO side-effect imports
// (only `@langchain/core/messages`). Prompt.js is not importable in plain node (a
// transitive doc-loader dependency throws at import), which is why this logic is
// factored out here where it can be unit-tested directly, keyless and model-free.
import { SystemMessage, HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";

// Deserialize a single stored history message into the LangChain message object the
// model expects. `index` is used only to make the error message locate a bad entry.
//
// Stored roles:
//   - "system"              -> SystemMessage
//   - "assistant_with_tool" -> AIMessage carrying tool_calls (the model's tool turn).
//       When loaded from disk `content` is the JSON-serialized AIMessage
//       ({ lc, type, id, kwargs: { content, tool_calls, additional_kwargs } }); in
//       memory it may still be the live AIMessage. Both are handled.
//   - "assistant"           -> AIMessage (plain text answer)
//   - "tool"                -> ToolMessage. The current on-disk shape is a flat
//       { content, tool_call_id, name } entry; two legacy shapes (a serialized
//       ToolMessage under content.kwargs, or a nested content.content) are still read.
//   - anything else         -> HumanMessage
export function deserializeMessage(message, index) {
  try {
    const content = [];

    if (message.content) {
      content.push({ type: "text", text: message.content });
    }

    if (message.images) {
      message.images.forEach(image => {
        content.push(image);
      });
    }

    if (message.role === "system") {
      return new SystemMessage({ content });
    } else if (message.role === "assistant_with_tool") {
      if (message.content && message.content.kwargs) {
        return new AIMessage({
          content: message.content.kwargs.content || "",
          tool_calls: message.content.kwargs.tool_calls || [],
          additional_kwargs: message.content.kwargs.additional_kwargs || {}
        });
      } else {
        return new AIMessage({ ...message.content });
      }
    } else if (message.role === "assistant") {
      return new AIMessage({ content });
    } else if (message.role === "tool") {
      // Handle raw tool message objects (our new format)
      if (message.tool_call_id && message.name) {
        return new ToolMessage({
          content: message.content,
          tool_call_id: message.tool_call_id,
          name: message.name
        });
      } else if (message.content && message.content.kwargs) {
        let toolContent = [];
        if (Array.isArray(message.content.kwargs.content)) {
          // Process all content types, not just text
          toolContent = message.content.kwargs.content.map(item => {
            if (item.type === "text") {
              return { type: "text", text: item.text };
            } else if (item.type === "image_url") {
              return { type: "image_url", image_url: item.image_url };
            }
            return item;
          });
        } else if (typeof message.content.kwargs.content === "string") {
          toolContent = [{ type: "text", text: message.content.kwargs.content }];
        }

        return new ToolMessage({
          content: toolContent.length > 0 ? toolContent : [{ type: "text", text: "Tool response" }],
          tool_call_id: message.content.kwargs.tool_call_id,
          name: message.content.kwargs.name
        });
      } else {
        const toolContent = message.content.content || message.content;
        return new ToolMessage({
          content: typeof toolContent === "string" ? toolContent : JSON.stringify(toolContent),
          tool_call_id: message.content.tool_call_id || "unknown",
          name: message.content.name || "unknown"
        });
      }
    }
    return new HumanMessage({ content });
  } catch (error) {
    throw new Error(`Error processing message at index ${index}: ${error.message}. Message: ${JSON.stringify(message)}`);
  }
}

// Recover full base64 image data for `saveImage` tool calls whose `content` argument
// the model truncated with an ellipsis ("...") — models routinely elide long base64
// blobs when echoing a prior tool result. For each such call we walk BACKWARD through
// the conversation looking for the most recent `tool` message that carries a full
// image_url data URL (under the serialized ToolMessage `kwargs.content` array) and
// substitute it back into the tool-call args so the file is written from the real
// bytes. Mutates the matching `toolCall.args.content` in place (matching the engine's
// original inlined behavior); returns nothing.
export function recoverTruncatedImageArgs(toolCalls, messages) {
  for (const toolCall of toolCalls) {
    if (toolCall.args && typeof toolCall.args.content === "string" && toolCall.args.content.includes("...")) {
      console.error("WARNING: Tool call argument appears to be truncated:", toolCall.name, "content length:", toolCall.args.content.length);
    }

    if (toolCall.name === "saveImage" && toolCall.args && toolCall.args.content && toolCall.args.content.includes("...")) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role === "tool" && msg.content) {
          let fullBase64 = null;
          try {
            if (typeof msg.content === "string") {
              const parsed = JSON.parse(msg.content);
              if (parsed.kwargs && parsed.kwargs.content && Array.isArray(parsed.kwargs.content)) {
                const imageItem = parsed.kwargs.content.find(item => item.type === "image_url");
                if (imageItem && imageItem.image_url && imageItem.image_url.url) {
                  fullBase64 = imageItem.image_url.url;
                }
              }
            } else if (msg.content.content) {
              const parsed = JSON.parse(msg.content.content);
              if (parsed.kwargs && parsed.kwargs.content && Array.isArray(parsed.kwargs.content)) {
                const imageItem = parsed.kwargs.content.find(item => item.type === "image_url");
                if (imageItem && imageItem.image_url && imageItem.image_url.url) {
                  fullBase64 = imageItem.image_url.url;
                }
              }
            }
          } catch (e) {
            // Not JSON, continue searching
          }
          if (fullBase64) {
            console.log("Found full base64 image data, replacing truncated content");
            toolCall.args.content = fullBase64;
            break;
          }
        }
      }
    }
  }
}

// Reduce one in-memory message to the shape that is persisted to the history file.
// Only `tool` entries are rewritten (to the flat { role, content, tool_call_id, name,
// timestamp } shape, preserving any recorded `policy` decision); every other role is
// stored as-is.
export function simplifyMessageForHistory(message) {
  if (message.role === "tool") {
    const entry = {
      role: "tool",
      content: message.content,
      tool_call_id: message.tool_call_id,
      name: message.name,
      timestamp: message.timestamp
    };
    // Preserve the policy decision recorded on this tool entry (shared history/trace
    // structure — the `policy` field on tool entries).
    if (message.policy) entry.policy = message.policy;
    return entry;
  }
  return message;
}

// Assemble the persisted message list: drop transient system messages (base/user
// instructions injected each run carry no timestamp) but keep any timestamped system
// message, then simplify each remaining entry.
export function simplifyMessagesForHistory(messages) {
  return messages
    .filter(message => message.role !== "system" || message.timestamp)
    .map(message => simplifyMessageForHistory(message));
}

// Merge all system-role messages, in order, into one leading system message and keep
// every non-system message in its original position. `extraSystem` (e.g. the
// output-schema format instructions) is appended last so it stays part of the single
// system message rather than being injected mid-conversation. This keeps the assembled
// sequence valid for providers that only permit a system message as the first passed
// message (Anthropic, Bedrock/Claude, ...).
export function collapseSystemMessages(messages, extraSystem = null) {
  const systemContents = [];
  const systemImages = [];
  const rest = [];

  for (const message of messages) {
    if (message && message.role === "system") {
      if (typeof message.content === "string" && message.content.trim() !== "") {
        systemContents.push(message.content);
      }
      if (Array.isArray(message.images) && message.images.length > 0) {
        systemImages.push(...message.images);
      }
    } else {
      rest.push(message);
    }
  }

  if (extraSystem && extraSystem.trim() !== "") {
    systemContents.push(extraSystem);
  }

  if (systemContents.length === 0 && systemImages.length === 0) {
    return rest;
  }

  const systemMessage = { role: "system", content: systemContents.join("\n\n") };
  if (systemImages.length > 0) {
    systemMessage.images = systemImages;
  }

  return [systemMessage, ...rest];
}
