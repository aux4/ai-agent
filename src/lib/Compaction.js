import fs from "node:fs";
import path from "node:path";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { getModel } from "./Models.js";

const DEFAULT_SUMMARIZATION_PROMPT = `You are a conversation compactor. Produce a structured summary of the conversation so the agent can resume work without losing context.

Use EXACTLY this format:

## Goal
What the user asked for (one sentence).

## Constraints & Preferences
Any requirements, preferences, or boundaries the user specified. Omit if none.

## Progress
### Done
- [completed item] — brief outcome
### In Progress
- [current item] — what's been started but not finished
### Blocked
- [blocked item] — what's waiting and why

## Key Decisions
- [decision] — why it was chosen (one line each)

## Next Steps
What should happen next, in order.

## Critical Context
Any important facts, numbers, or context that would be lost without this summary. Omit if nothing critical.

Rules:
- Be concise — one line per item
- Preserve ALL task/todo names exactly (the agent uses them to resume)
- Preserve ALL file paths exactly (the agent needs them to avoid re-reading)
- If a previous compaction summary exists in the conversation, merge its content into yours — don't lose accumulated context
- Never fabricate information not in the conversation`;

function loadSummarizationPrompt(promptFile) {
  if (promptFile) {
    const resolved = path.resolve(promptFile);
    if (fs.existsSync(resolved)) {
      return fs.readFileSync(resolved, "utf-8");
    }
  }
  return DEFAULT_SUMMARIZATION_PROMPT;
}

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

export async function summarizeMessages(messages, modelConfig, options = {}) {
  const formattedText = formatMessagesForSummary(messages);
  const prompt = loadSummarizationPrompt(options.promptFile);

  const Model = getModel(modelConfig.type || "openai");
  const model = new Model(modelConfig.config);

  const promptTemplate = ChatPromptTemplate.fromMessages([
    new SystemMessage({ content: [{ type: "text", text: prompt }] }),
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

  // Extract file operations from messages being summarized
  const fileOps = extractFileOps(messagesToSummarize);

  // Also collect file ops from any previous compaction summary
  const previousOps = extractPreviousFileOps(messagesToSummarize);
  const mergedOps = mergeFileOps(previousOps, fileOps);

  const summaryContent = await summarizeMessages(messagesToSummarize, modelConfig, {
    promptFile: options.promptFile
  });

  // Append file tracking to the structured summary
  const fileTracking = formatFileTracking(mergedOps);

  const summaryMessage = {
    role: "assistant",
    content: `[Summary of previous conversation]\n\n${summaryContent}${fileTracking}`,
    compacted: true,
    timestamp: Date.now()
  };

  const condensedKept = condenseToolMessages(keptMessages);

  return [...systemMessages, summaryMessage, ...condensedKept];
}

// --- File operation tracking ---

function extractFileOps(messages) {
  const readFiles = new Set();
  const modifiedFiles = new Set();
  const executedCommands = new Set();

  for (const msg of messages) {
    if (msg.role === "assistant_with_tool") {
      const toolCalls = extractToolCalls(msg);
      for (const tc of toolCalls) {
        const args = typeof tc.args === "string" ? tryParseJson(tc.args) : tc.args;

        if (tc.name === "readFile" && args && args.path) {
          readFiles.add(args.path);
        } else if (tc.name === "writeFile" && args && args.path) {
          modifiedFiles.add(args.path);
        } else if (tc.name === "editFile" && args && args.path) {
          modifiedFiles.add(args.path);
        } else if (tc.name === "createDirectory" && args && args.path) {
          modifiedFiles.add(args.path);
        } else if (tc.name === "removeFiles" && args && args.path) {
          modifiedFiles.add(args.path);
        } else if (tc.name === "executeAux4" && args) {
          const cmd = args.command || args;
          if (typeof cmd === "string" && cmd.length < 200) {
            executedCommands.add(cmd);
          }
        }
      }
    }
  }

  return {
    readFiles: [...readFiles],
    modifiedFiles: [...modifiedFiles],
    executedCommands: [...executedCommands].slice(0, 20) // cap to avoid bloat
  };
}

function extractPreviousFileOps(messages) {
  const readFiles = new Set();
  const modifiedFiles = new Set();

  for (const msg of messages) {
    if (msg.compacted && typeof msg.content === "string") {
      const readMatch = msg.content.match(/<read-files>([\s\S]*?)<\/read-files>/);
      if (readMatch) {
        readMatch[1].split(",").map(f => f.trim()).filter(Boolean).forEach(f => readFiles.add(f));
      }
      const modMatch = msg.content.match(/<modified-files>([\s\S]*?)<\/modified-files>/);
      if (modMatch) {
        modMatch[1].split(",").map(f => f.trim()).filter(Boolean).forEach(f => modifiedFiles.add(f));
      }
    }
  }

  return {
    readFiles: [...readFiles],
    modifiedFiles: [...modifiedFiles],
    executedCommands: []
  };
}

function mergeFileOps(previous, current) {
  const readFiles = new Set([...previous.readFiles, ...current.readFiles]);
  const modifiedFiles = new Set([...previous.modifiedFiles, ...current.modifiedFiles]);
  const executedCommands = current.executedCommands; // only keep recent commands

  return {
    readFiles: [...readFiles],
    modifiedFiles: [...modifiedFiles],
    executedCommands
  };
}

function formatFileTracking(ops) {
  const parts = [];

  if (ops.readFiles.length > 0) {
    parts.push(`\n<read-files>${ops.readFiles.join(", ")}</read-files>`);
  }
  if (ops.modifiedFiles.length > 0) {
    parts.push(`\n<modified-files>${ops.modifiedFiles.join(", ")}</modified-files>`);
  }
  if (ops.executedCommands.length > 0) {
    parts.push(`\n<executed-commands>${ops.executedCommands.join("; ")}</executed-commands>`);
  }

  return parts.length > 0 ? "\n" + parts.join("") : "";
}

function tryParseJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// --- Tool message condensation ---

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
