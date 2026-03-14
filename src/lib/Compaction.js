import { ChatPromptTemplate } from "@langchain/core/prompts";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { getModel } from "./Models.js";

const SUMMARIZATION_PROMPT = `You are a conversation summarizer. Your job is to create a concise but comprehensive summary of the conversation history provided below. Output the summary in markdown format.

Preserve the following in your summary:
- Key facts, data points, and numbers mentioned
- Decisions made and their reasoning
- Important context about the user's goals and preferences
- Tool calls made and their significant results
- Any constraints, requirements, or preferences expressed by the user
- The current state of any ongoing tasks

Be concise but do not omit important details.`;

const MEMORY_PROMPT = `You are a session memory recorder. Distill the conversation below into a short memory entry for future reference. Output markdown.

Include ONLY:
- What was requested (one sentence)
- What was accomplished (bullet points)
- Key decisions made and why
- Important outcomes, data, or artifacts produced
- Unresolved items or follow-ups

Keep it under 300 words. Omit greetings, tool mechanics, and intermediate steps.`;

export async function rememberMessages(messages, modelConfig) {
  const formattedText = formatMessagesForSummary(messages);

  const Model = getModel(modelConfig.type || "openai");
  const model = new Model(modelConfig.config);

  const promptTemplate = ChatPromptTemplate.fromMessages([
    new SystemMessage({ content: [{ type: "text", text: MEMORY_PROMPT }] }),
    new HumanMessage({ content: [{ type: "text", text: `Here is the session to remember:\n\n${formattedText}` }] })
  ]);

  const chain = promptTemplate.pipe(model);
  const response = await chain.invoke();

  return typeof response.content === "string"
    ? response.content
    : Array.isArray(response.content)
      ? response.content.filter(c => c.type === "text").map(c => c.text).join("")
      : JSON.stringify(response.content);
}

export function shouldCompact(promptTokens, compactionConfig) {
  if (!compactionConfig || !compactionConfig.contextWindow) {
    return false;
  }

  const maxPercent = compactionConfig.maxContextPercent || 85;
  const threshold = (compactionConfig.contextWindow * maxPercent) / 100;

  return promptTokens >= threshold;
}

export async function summarizeMessages(messages, modelConfig) {
  const formattedText = formatMessagesForSummary(messages);

  const Model = getModel(modelConfig.type || "openai");
  const model = new Model(modelConfig.config);

  const promptTemplate = ChatPromptTemplate.fromMessages([
    new SystemMessage({ content: [{ type: "text", text: SUMMARIZATION_PROMPT }] }),
    new HumanMessage({ content: [{ type: "text", text: `Here is the conversation to summarize:\n\n${formattedText}` }] })
  ]);

  const chain = promptTemplate.pipe(model);
  const response = await chain.invoke();

  return typeof response.content === "string"
    ? response.content
    : Array.isArray(response.content)
      ? response.content.filter(c => c.type === "text").map(c => c.text).join("")
      : JSON.stringify(response.content);
}

export async function compactMessages(messages, modelConfig, options = {}) {
  const keepLast = options.keepLastMessages || 6;

  const systemMessages = messages.filter(m => m.role === "system");
  const conversationMessages = messages.filter(m => m.role !== "system");

  if (conversationMessages.length <= keepLast + 1) {
    const condensed = condenseToolMessages(conversationMessages);
    return [...systemMessages, ...condensed];
  }

  const messagesToSummarize = conversationMessages.slice(0, conversationMessages.length - keepLast);
  const keptMessages = conversationMessages.slice(conversationMessages.length - keepLast);

  const summaryContent = await summarizeMessages(messagesToSummarize, modelConfig);

  const summaryMessage = {
    role: "assistant",
    content: `[Summary of previous conversation]\n\n${summaryContent}`,
    compacted: true,
    timestamp: Date.now()
  };

  const condensedKept = condenseToolMessages(keptMessages);

  return [...systemMessages, summaryMessage, ...condensedKept];
}

function condenseToolMessages(messages) {
  const result = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    if (msg.role === "assistant_with_tool") {
      // Collect the tool call sequence: assistant_with_tool + tool results
      const toolCalls = extractToolCalls(msg);
      const parts = [];
      i++;

      // Collect subsequent tool result messages
      while (i < messages.length && messages[i].role === "tool") {
        const toolMsg = messages[i];
        const name = toolMsg.name || "unknown";
        const callInfo = toolCalls.find(tc => tc.id === toolMsg.tool_call_id);
        const args = callInfo ? callInfo.args : "";
        const resultText = truncate(extractToolResult(toolMsg.content), 500);
        parts.push(`**${name}**(${truncate(args, 200)}) → ${resultText}`);
        i++;
      }

      // Get any text content from the assistant_with_tool message
      const assistantText = extractAssistantText(msg);
      let content = "[Tool calls]\n" + parts.join("\n");
      if (assistantText) {
        content = assistantText + "\n\n" + content;
      }

      result.push({
        role: "assistant",
        content,
        timestamp: msg.timestamp
      });
    } else {
      result.push(msg);
      i++;
    }
  }

  return result;
}

function extractToolCalls(msg) {
  const content = msg.content;
  let toolCalls = [];

  if (content && content.kwargs && content.kwargs.tool_calls) {
    toolCalls = content.kwargs.tool_calls;
  } else if (content && content.tool_calls) {
    toolCalls = content.tool_calls;
  }

  return toolCalls.map(tc => ({
    id: tc.id,
    name: tc.name,
    args: typeof tc.args === "string" ? tc.args : JSON.stringify(tc.args || {})
  }));
}

function extractAssistantText(msg) {
  const content = msg.content;
  let text = "";

  if (content && content.kwargs && content.kwargs.content) {
    const inner = content.kwargs.content;
    if (typeof inner === "string") {
      text = inner;
    } else if (Array.isArray(inner)) {
      text = inner.filter(c => c.type === "text").map(c => c.text).join("");
    }
  } else if (typeof content === "string") {
    text = content;
  }

  return text.trim();
}

function formatMessagesForSummary(messages) {
  return messages
    .filter(message => message.role !== "assistant_with_tool")
    .map(message => {
      if (message.role === "tool") {
        const name = message.name || "unknown";
        const result = extractToolResult(message.content);
        return `TOOL RESULT (${name}): ${truncate(result, 500)}`;
      }

      const role = message.role.toUpperCase();
      const content = typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content);

      return `${role}: ${content}`;
    }).join("\n\n");
}

function extractToolResult(content) {
  if (typeof content === "string") {
    try {
      return extractToolResult(JSON.parse(content));
    } catch {
      return content;
    }
  }

  if (content && content.kwargs && content.kwargs.content) {
    return extractToolResult(content.kwargs.content);
  }

  if (Array.isArray(content)) {
    return content
      .filter(item => item.type === "text")
      .map(item => item.text)
      .join("\n") || JSON.stringify(content);
  }

  if (content && typeof content === "object") {
    if (content.type === "text" && content.text) return content.text;
    if (content.content) return extractToolResult(content.content);
    return JSON.stringify(content);
  }

  return String(content);
}

function truncate(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...[truncated]";
}
