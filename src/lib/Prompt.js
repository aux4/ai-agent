import fs from "node:fs";
import path from "node:path";

import { SystemMessage, HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { getModel } from "./Models.js";
import { readFile, asJson } from "./util/FileUtils.js";
import { buildZodSchema } from "./util/SchemaUtils.js";
import mime from "mime-types";
import Tools, { createTools } from "./Tools.js";
import { CONSEQUENTIAL_TOOLS as CONSEQUENTIAL_POLICY_TOOLS } from "./Policy.js";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { shouldCompact, compactMessages } from "./Compaction.js";
import { CodexApi } from "./CodexApi.js";
import { loadCodexAuth } from "./TokenRefresh.js";

const VARIABLE_REGEX = /\{([a-zA-Z0-9-_]+)\}/g;

export class PromptError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "PromptError";
    if (cause) {
      this.cause = cause;
    }
  }
}

class Prompt {
  constructor(config = {}, toolsConfig = {}, options = {}) {
    this.config = config;
    this.toolsConfig = toolsConfig;
    this.compactionConfig = options.compaction || null;
    this.policy = options.policy || null;
    this.messages = [];
    this.tokenUsage = { input: 0, output: 0, cached: 0, total: 0 };
    this.toolCallCount = 0;
    this.mcpClient = null;
    this.apiType = config.api || "chat";

    if (this.apiType === "codex") {
      const codexAuth = loadCodexAuth();
      if (!codexAuth) {
        throw new PromptError("Codex auth not found. Run 'codex login' first.");
      }
      this.codexApi = new CodexApi({ ...(config.config || {}), ...codexAuth });
    } else {
      const Model = getModel(config.type || "openai");
      const chatConfig = config.config || {};
      if (!chatConfig.model && (config.type || "openai") === "openai") {
        chatConfig.model = "gpt-5-mini";
      }
      this.model = new Model(chatConfig);
    }
  }

  async init() {
    // Wire the policy enforcement hook into the tool layer. The hook reads the LIVE
    // accumulated token usage plus the consequential tool call count — no separate
    // ledger. takeDecision lets execute() attach each decision to the history entry.
    if (this.policy) {
      this.toolsConfig = {
        ...this.toolsConfig,
        policy: this.policy,
        getUsage: () => ({ ...this.tokenUsage, calls: this.toolCallCount })
      };
    }

    // Create tools with configuration if provided
    const configuredTools = Object.keys(this.toolsConfig).length > 0 ? createTools(this.toolsConfig) : Tools;

    const mcpConfigPath = path.join(process.cwd(), "mcp.json");
    let mcpTools = [];

    if (fs.existsSync(mcpConfigPath)) {
      try {
        const mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, "utf-8"));
        this.mcpClient = new MultiServerMCPClient({ ...mcpConfig });
        mcpTools = await this.mcpClient.getTools();
      } catch (e) {
        console.error("Error reading mcp.json:", e.message);
      }
    }

    if (this.apiType === "codex") {
      this.codexApi.bindTools(Object.values(configuredTools));
      if (mcpTools.length > 0) {
        this.codexApi.bindTools(mcpTools);
      }
      this.tools = {
        ...configuredTools,
        ...mcpTools.reduce((acc, tool) => { acc[tool.name] = tool; return acc; }, {})
      };
    } else {
      const allTools = [...Object.values(configuredTools), ...mcpTools];
      this.model = this.model.bindTools(allTools);
      this.tools = {
        ...configuredTools,
        ...mcpTools.reduce((acc, tool) => { acc[tool.name] = tool; return acc; }, {})
      };
    }
  }

  async instructions(text, params) {
    if (!text) {
      return;
    }

    const message = await replacePromptVariables(text, params);

    this.messages.push({
      role: "system",
      content: message
    });
  }

  async history(file) {
    if (!file || file === "") return;

    this.historyFile = file;
    const historyData = (await readFile(file).then(asJson())) || [];
    if (Array.isArray(historyData)) {
      this.messages = this.messages.concat(historyData);
    } else if (historyData && typeof historyData === "object") {
      if (Array.isArray(historyData.messages)) {
        this.messages = this.messages.concat(historyData.messages);
      }
      if (historyData.tokenUsage && typeof historyData.tokenUsage === "object") {
        this.tokenUsage = {
          input: historyData.tokenUsage.input || 0,
          output: historyData.tokenUsage.output || 0,
          cached: historyData.tokenUsage.cached || 0,
          total: historyData.tokenUsage.total || 0
        };
      }
    }
  }

  setOutputSchema(schema) {
    this.outputSchema = schema;
  }

  setStreaming(enabled) {
    this.streaming = enabled;
  }

  onToken(callback) {
    this.tokenCallback = callback;
  }

  async message(text, params, role = "user") {
    const messageContent = await replacePromptVariables(text, params);

    const message = {
      role: role,
      content: messageContent
    };

    if (params && params.image && params.image.trim() !== "") {
      const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".tiff", ".ico"]);
      const imagePaths = params.image
        .split(",")
        .map(imagePath => imagePath.trim())
        .filter(imagePath => imagePath !== "")
        .filter(imagePath => {
          const ext = path.extname(imagePath).toLowerCase();
          if (!ext || !IMAGE_EXTENSIONS.has(ext)) {
            console.error(`Skipping invalid image path (no recognized image extension): ${imagePath}`);
            return false;
          }
          return true;
        });

      if (imagePaths.length > 0) {
        message.images = imagePaths
          .map(imagePath => path.resolve(imagePath.trim()))
          .filter(image => {
            if (!fs.existsSync(image)) {
              console.error(`Image file not found, skipping: ${image}`);
              return false;
            }
            return true;
          })
          .map(image => {
            const mimeType = mime.lookup(image);
            if (!mimeType) {
              console.error(`Unsupported image type, skipping: ${image}`);
              return null;
            }

            const imageBuffer = fs.readFileSync(image);
            const base64Image = imageBuffer.toString("base64");

            return { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } };
          })
          .filter(img => img !== null);
      }
    }

    message.timestamp = Date.now();
    this.messages.push(message);
    this.saveHistory();

    const answer = await this.execute();

    if (this.callback) {
      this.callback(`${answer}`);
    }
  }

  async execute() {
    if (!Array.isArray(this.messages)) {
      throw new Error(`Messages is not an array: ${typeof this.messages}`);
    }

    if (this.apiType === "codex") {
      return await this._executeCodex();
    }

    let messages = this.messages;

    if (this.outputSchema) {
      const schemaJson = JSON.stringify(this.outputSchema, null, 2);
      const formatInstructions = `You MUST respond with ONLY a valid JSON object. No other text, no markdown, no code blocks, no explanation.\nYour response must match this schema:\n${schemaJson}`;
      const formatMsg = { role: "system", content: formatInstructions };
      messages = [...this.messages.slice(0, -1), formatMsg, this.messages[this.messages.length - 1]];
    }

    const promptTemplate = ChatPromptTemplate.fromMessages(
      messages.map((message, index) => {
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
      })
    );

    let chain = promptTemplate.pipe(this.model);

    try {
      let response;

      if (this.streaming && !this.outputSchema) {
        response = await this._streamResponse(chain);
      } else {
        response = await chain.invoke();
      }

      this._accumulateTokenUsage(response);

      if (response.tool_calls && response.tool_calls.length > 0) {
        this.messages.push({ role: "assistant_with_tool", content: response, timestamp: Date.now() });
        this.saveHistory();

        // Pre-process saveImage tool calls to extract full base64 from previous tool responses
        for (const toolCall of response.tool_calls) {
          if (toolCall.args && typeof toolCall.args.content === "string" && toolCall.args.content.includes("...")) {
            console.error("WARNING: Tool call argument appears to be truncated:", toolCall.name, "content length:", toolCall.args.content.length);
          }

          if (toolCall.name === "saveImage" && toolCall.args && toolCall.args.content && toolCall.args.content.includes("...")) {
            for (let i = this.messages.length - 1; i >= 0; i--) {
              const msg = this.messages[i];
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

        // Execute all tool calls in parallel
        const toolNames = response.tool_calls.map(tc => tc.name).join(", ");
        console.error(`[tools] calling: ${toolNames}`);
        const toolResults = await Promise.all(
          response.tool_calls.map(async (toolCall) => {
            const argsPreview = typeof toolCall.args === "object" ? JSON.stringify(toolCall.args).slice(0, 200) : "";
            console.error(`[tool] ${toolCall.name}(${argsPreview})`);
            const startTime = Date.now();
            try {
              const tool = this.tools[toolCall.name];
              if (!tool) {
                console.error(`[tool] ${toolCall.name} => unknown tool`);
                return {
                  role: "tool",
                  content: `Error: Unknown tool "${toolCall.name}". Available tools: ${Object.keys(this.tools).join(", ")}`,
                  tool_call_id: toolCall.id,
                  name: toolCall.name,
                  timestamp: Date.now()
                };
              }

              // Count consequential tool calls toward the policy budget and pass the
              // call id so the policy can record its decision against this entry.
              let invokeArgs = toolCall.args;
              if (this.policy && CONSEQUENTIAL_POLICY_TOOLS.has(toolCall.name)) {
                this.toolCallCount += 1;
                invokeArgs = { ...toolCall.args, __policyCallId: toolCall.id };
              }

              const toolResponse = await tool.invoke(invokeArgs);
              const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
              const preview = typeof toolResponse === "string" ? toolResponse.slice(0, 100) : "";
              console.error(`[tool] ${toolCall.name} => done (${elapsed}s) ${preview}`);
              const entry = {
                role: "tool",
                content: toolResponse,
                tool_call_id: toolCall.id,
                name: toolCall.name,
                timestamp: Date.now()
              };
              // Attach the policy decision to the history entry (only when a policy
              // is active and --history is set, takeDecision returns the record).
              if (this.policy && this.historyFile) {
                const decision = this.policy.takeDecision(toolCall.id);
                if (decision) entry.policy = decision;
              }
              return entry;
            } catch (error) {
              const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
              console.error(`[tool] ${toolCall.name} => error (${elapsed}s): ${error.message}`);
              return {
                role: "tool",
                content: `Error executing tool "${toolCall.name}": ${error.message}`,
                tool_call_id: toolCall.id,
                name: toolCall.name,
                timestamp: Date.now()
              };
            }
          })
        );

        this.messages.push(...toolResults);
        this.saveHistory();

        return await this.execute();
      }

      let answer =
        typeof response === "string"
          ? response
          : typeof response.content === "string"
            ? response.content
            : Array.isArray(response.content)
              ? response.content.filter(c => c.type === "text").map(c => c.text).join("") || JSON.stringify(response)
              : JSON.stringify(response);

      if (this.outputSchema) {
        let jsonStr = answer.trim();
        const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
        if (codeBlockMatch) {
          jsonStr = codeBlockMatch[1].trim();
        }
        const zodSchema = buildZodSchema(this.outputSchema);
        const parsed = zodSchema.parse(JSON.parse(jsonStr));
        answer = JSON.stringify(parsed);
      }

      this.messages.push({ role: "assistant", content: answer, timestamp: Date.now() });

      if (this.compactionConfig && this.compactionConfig.contextWindow) {
        const promptTokens = response.response_metadata?.tokenUsage?.promptTokens
          || response.usage_metadata?.input_tokens || 0;
        if (shouldCompact(promptTokens, this.compactionConfig)) {
          const compactionModel = this.compactionConfig.model || this.config;
          try {
            this.messages = await compactMessages(this.messages, compactionModel, {
              keepLastMessages: this.compactionConfig.keepLastMessages || 6,
              promptFile: this.compactionConfig.promptFile
            });
            this.compacted = true;
          } catch (err) {
            console.error(`[compact] Warning: ${err.message}`);
          }
        }
      }

      this.saveHistory(true);

      return answer;
    } catch (e) {
      this.saveHistory(true);
      throw new PromptError(e.message, e);
    }
  }

  async _streamResponse(chain) {
    let accumulated = null;
    const stream = await chain.stream();

    for await (const chunk of stream) {
      if (!accumulated) {
        accumulated = chunk;
      } else {
        accumulated = accumulated.concat(chunk);
      }

      if (this.tokenCallback && chunk.content) {
        const text = typeof chunk.content === "string" ? chunk.content : "";
        if (text) {
          this.tokenCallback(text);
        }
      }
    }

    return accumulated;
  }

  async _executeCodex() {
    try {
      const result = await this.codexApi.execute(this.messages, {
        streaming: this.streaming && !this.outputSchema,
        tokenCallback: this.tokenCallback,
        outputSchema: this.outputSchema
      });

      this.tokenUsage.input += result.usage.input || 0;
      this.tokenUsage.output += result.usage.output || 0;
      this.tokenUsage.cached += result.usage.cached || 0;
      this.tokenUsage.total += (result.usage.input || 0) + (result.usage.output || 0);

      let answer = result.answer;

      if (this.outputSchema) {
        let jsonStr = answer.trim();
        const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
        if (codeBlockMatch) {
          jsonStr = codeBlockMatch[1].trim();
        }
        const zodSchema = buildZodSchema(this.outputSchema);
        const parsed = zodSchema.parse(JSON.parse(jsonStr));
        answer = JSON.stringify(parsed);
      }

      this.messages.push({ role: "assistant", content: answer, timestamp: Date.now() });

      if (this.compactionConfig && this.compactionConfig.contextWindow) {
        const promptTokens = result.usage.input || 0;
        if (shouldCompact(promptTokens, this.compactionConfig)) {
          const compactionModel = this.compactionConfig.model || this.config;
          try {
            this.messages = await compactMessages(this.messages, compactionModel, {
              keepLastMessages: this.compactionConfig.keepLastMessages || 6,
              promptFile: this.compactionConfig.promptFile,
              codexApi: (!this.compactionConfig.model && this.apiType === "codex") ? this.codexApi : null
            });
            this.compacted = true;
          } catch (err) {
            console.error(`[compact] Warning: ${err.message}`);
          }
        }
      }

      this.saveHistory(true);
      return answer;
    } catch (e) {
      this.saveHistory(true);
      throw new PromptError(e.message, e);
    }
  }

  onMessage(callback) {
    this.callback = callback;
  }

  _accumulateTokenUsage(response) {
    if (!response) return;
    const input = response.response_metadata?.tokenUsage?.promptTokens
      || response.usage_metadata?.input_tokens
      || 0;
    const output = response.response_metadata?.tokenUsage?.completionTokens
      || response.usage_metadata?.output_tokens
      || 0;

    // Cached input tokens — different providers expose this differently
    const cached = response.usage_metadata?.input_token_details?.cache_read
      || response.response_metadata?.usage?.cache_read_input_tokens
      || response.response_metadata?.usage?.prompt_tokens_details?.cached_tokens
      || response.response_metadata?.tokenUsage?.promptTokensDetails?.cachedTokens
      || 0;

    if (input || output || cached) {
      this.tokenUsage.input += input;
      this.tokenUsage.output += output;
      this.tokenUsage.cached += cached;
      this.tokenUsage.total += (input + output);
    }
  }

  saveHistory(sync = false) {
    if (!this.historyFile) return;
    try {
      const simplifiedMessages = this.messages
        .filter(message => message.role !== "system" || message.timestamp)
        .map(message => {
          if (message.role === "tool") {
            const entry = {
              role: "tool",
              content: message.content,
              tool_call_id: message.tool_call_id,
              name: message.name,
              timestamp: message.timestamp
            };
            // Preserve the policy decision recorded on this tool entry (shared
            // history/trace structure — the `policy` field on tool entries).
            if (message.policy) entry.policy = message.policy;
            return entry;
          }
          return message;
        });

      if (simplifiedMessages.length === 0) return;

      const data = JSON.stringify({
        messages: simplifiedMessages,
        tokenUsage: this.tokenUsage
      });
      if (data.length < 3) return;

      // Skip writing if file on disk is larger (avoids clobbering from a
      // concurrent process). Allow writes when compacted, when the file is
      // small (seed-only), or when the difference is modest (format change).
      if (!this.compacted) {
        try {
          const existing = fs.statSync(this.historyFile);
          if (existing.size > data.length * 1.5 && existing.size > 1024) return;
        } catch {}
      }

      // Always write synchronously to prevent 0-byte files from async
      // truncation when the process exits before the write completes.
      fs.writeFileSync(this.historyFile, data);
    } catch (error) {
      console.error("Error writing history file:", error.message);
    }
  }

  async close() {
    if (!this.mcpClient) return;

    await this.mcpClient.close();
    this.mcpClient = null;
  }
}

async function replacePromptVariables(text, params = {}) {
  if (!text) return text;
  
  const variables = text.match(VARIABLE_REGEX);
  const variableValues = (variables || [])
    .map(variable => variable.substring(1, variable.length - 1))
    .reduce((acc, variable) => ({ ...acc, [variable]: undefined }), {});

  for (const variable in variableValues) {
    variableValues[variable] = await params[variable];
  }

  let output = text;
  for (const variable in variableValues) {
    const value = variableValues[variable];
    if (value === undefined) {
      continue;
    }
    output = output.replaceAll(`{${variable}}`, variableValues[variable]);
  }

  return output;
}

export default Prompt;
