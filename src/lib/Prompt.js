import fs from "node:fs";
import path from "node:path";

import { SystemMessage, HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { getModel } from "./Models.js";
import { readFile, asJson } from "./util/FileUtils.js";
import { buildZodSchema } from "./util/SchemaUtils.js";
import mime from "mime-types";
import Tools, { createTools } from "./Tools.js";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { shouldCompact, compactMessages } from "./Compaction.js";

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
    this.messages = [];
    this.mcpClient = null;

    const Model = getModel(config.type || "openai");
    this.model = new Model(config.config);
  }

  async init() {
    // Create tools with configuration if provided
    const configuredTools = Object.keys(this.toolsConfig).length > 0 ? createTools(this.toolsConfig) : Tools;

    const mcpConfigPath = path.join(process.cwd(), "mcp.json");
    if (!fs.existsSync(mcpConfigPath)) {
      this.model = this.model.bindTools(Object.values(configuredTools));
      this.tools = configuredTools;
      return;
    }

    try {
      const mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, "utf-8"));

      this.mcpClient = new MultiServerMCPClient({
        ...mcpConfig
      });

      const mcpTools = await this.mcpClient.getTools();
      const allTools = [...Object.values(configuredTools), ...mcpTools];
      this.model = this.model.bindTools(allTools);

      this.tools = {
        ...configuredTools,
        ...mcpTools.reduce((acc, tool) => {
          acc[tool.name] = tool;
          return acc;
        }, {})
      };
    } catch (e) {
      console.error("Error reading mcp.json:", e.message);
      this.model = this.model.bindTools(Object.values(configuredTools));
      this.tools = configuredTools;
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
    const historyMessages = (await readFile(file).then(asJson())) || [];
    if (Array.isArray(historyMessages)) {
      this.messages = this.messages.concat(historyMessages);
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
        const toolResults = await Promise.all(
          response.tool_calls.map(async (toolCall) => {
            try {
              const tool = this.tools[toolCall.name];
              if (!tool) {
                return {
                  role: "tool",
                  content: `Error: Unknown tool "${toolCall.name}". Available tools: ${Object.keys(this.tools).join(", ")}`,
                  tool_call_id: toolCall.id,
                  name: toolCall.name,
                  timestamp: Date.now()
                };
              }
              const toolResponse = await tool.invoke(toolCall.args);
              return {
                role: "tool",
                content: toolResponse,
                tool_call_id: toolCall.id,
                name: toolCall.name,
                timestamp: Date.now()
              };
            } catch (error) {
              console.error(`Tool "${toolCall.name}" failed: ${error.message}`);
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
              keepLastMessages: this.compactionConfig.keepLastMessages || 6
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

  onMessage(callback) {
    this.callback = callback;
  }

  saveHistory(sync = false) {
    if (!this.historyFile) return;
    try {
      const simplifiedMessages = this.messages
        .filter(message => message.role !== "system")
        .map(message => {
          if (message.role === "tool") {
            return {
              role: "tool",
              content: message.content,
              tool_call_id: message.tool_call_id,
              name: message.name,
              timestamp: message.timestamp
            };
          }
          return message;
        });

      if (simplifiedMessages.length === 0) return;

      const data = JSON.stringify(simplifiedMessages);
      if (data.length < 3) return;

      // Don't overwrite with less data than what's on disk (unless compacted)
      if (!this.compacted) {
        try {
          const existing = fs.statSync(this.historyFile);
          if (existing.size > data.length) return;
        } catch {}
      }

      if (sync) {
        fs.writeFileSync(this.historyFile, data);
      } else {
        fs.writeFile(this.historyFile, data, (err) => {
          if (err) console.error("Error writing history file:", err.message);
        });
      }
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
