import fs from "node:fs";
import path from "node:path";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { SystemMessage, HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { getModel } from "./Models.js";
import { readFile, asJson } from "./util/FileUtils.js";
import mime from "mime-types";
import Tools, { createTools } from "./Tools.js";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";

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
  constructor(config = {}, toolsConfig = {}) {
    this.config = config;
    this.toolsConfig = toolsConfig;
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
      message.images = params.image
        .split(",")
        .map(imagePath => imagePath.trim())
        .filter(imagePath => imagePath !== "")
        .map(imagePath => path.resolve(imagePath.trim()))
        .map(image => {
          if (!fs.existsSync(image)) {
            throw new Error(`Image file not found: ${image}`);
          }

          const mimeType = mime.lookup(image);
          if (!mimeType) {
            throw new Error(`Unsupported image type: ${image}`);
          }

          const imageBuffer = fs.readFileSync(image);
          const base64Image = imageBuffer.toString("base64");

          return { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } };
        });
    }

    this.messages.push(message);

    const answer = await this.execute();

    if (this.callback) {
      this.callback(`${answer}`);
    }
  }

  async execute() {
    if (!Array.isArray(this.messages)) {
      throw new Error(`Messages is not an array: ${typeof this.messages}`);
    }
    
    const promptTemplate = ChatPromptTemplate.fromMessages(
      this.messages.map((message, index) => {
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

    if (this.outputSchema) {
      const parser = StructuredOutputParser.fromNamesAndDescriptions(this.outputSchema);
      chain = chain.pipe(parser);
    }

    try {
      let response;

      if (this.streaming && !this.outputSchema) {
        response = await this._streamResponse(chain);
      } else {
        response = await chain.invoke();
      }

      if (response.tool_calls && response.tool_calls.length > 0) {
        this.messages.push({ role: "assistant_with_tool", content: response });

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
            const tool = this.tools[toolCall.name];
            const toolResponse = await tool.invoke(toolCall.args);
            return {
              role: "tool",
              content: toolResponse,
              tool_call_id: toolCall.id,
              name: toolCall.name
            };
          })
        );

        this.messages.push(...toolResults);

        return await this.execute();
      }

      const answer =
        typeof response === "string"
          ? response
          : typeof response.content === "string"
            ? response.content
            : JSON.stringify(response);
      this.messages.push({ role: "assistant", content: answer });

      if (this.historyFile) {
        try {
          // Simplify messages only for history saving, but preserve image data
          const simplifiedMessages = this.messages
            .filter(message => message.role !== "system")
            .map(message => {
              if (message.role === "tool") {
                // For tool responses, preserve the original structure if it contains image data
                // This ensures MCP tool responses with embedded images are kept intact
                return {
                  role: "tool",
                  content: message.content, // Keep original content structure
                  tool_call_id: message.tool_call_id,
                  name: message.name
                };
              }
              return message;
            });
          const historyData = JSON.stringify(simplifiedMessages);
          fs.writeFileSync(this.historyFile, historyData);
        } catch (error) {
          console.error("Error writing history file:", error.message);
        }
      }

      return answer;
    } catch (e) {
      // Save history even if there was an error, as long as we have messages
      if (this.historyFile && this.messages.length > 0) {
        try {
          // Simplify messages only for history saving, but preserve image data
          const simplifiedMessages = this.messages
            .filter(message => message.role !== "system")
            .map(message => {
              if (message.role === "tool") {
                // For tool responses, preserve the original structure if it contains image data
                // This ensures MCP tool responses with embedded images are kept intact
                return {
                  role: "tool",
                  content: message.content, // Keep original content structure
                  tool_call_id: message.tool_call_id,
                  name: message.name
                };
              }
              return message;
            });
          const historyData = JSON.stringify(simplifiedMessages);
          fs.writeFileSync(this.historyFile, historyData);
        } catch (historyError) {
          console.error("Error writing history file after error:", historyError.message);
        }
      }
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
