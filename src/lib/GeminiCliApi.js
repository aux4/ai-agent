import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import { GeminiTokenManager } from "./GeminiAuth.js";

const GEMINI_CLI_BASE_URL = "https://cloudcode-pa.googleapis.com/v1internal";

export class GeminiCliApi {
  constructor(config = {}) {
    const { model, accessToken, refreshToken, expiresAt, baseUrl, clientId, clientSecret, ...extraParams } = config;
    this.modelName = model || "gemini-2.5-flash";
    this.baseUrl = baseUrl || GEMINI_CLI_BASE_URL;
    this.extraParams = extraParams;
    this.tokenManager = new GeminiTokenManager({ accessToken, refreshToken, expiresAt, clientId, clientSecret });
    this.tools = [];
    this.toolMap = {};
  }

  bindTools(tools) {
    for (const tool of tools) {
      const openAiTool = convertToOpenAITool(tool);
      const fn = openAiTool.function;
      let description = fn.description || "";
      if (description.length > 1024) {
        description = description.slice(0, 1024).replace(/\n[^\n]*$/, "") + "\n...";
      }
      const params = { ...fn.parameters };
      delete params.$schema;
      delete params.additionalProperties;

      this.tools.push({
        name: fn.name,
        description,
        parameters: convertSchemaToGemini(params)
      });
      this.toolMap[fn.name] = tool;
    }
    return this;
  }

  extractInstructions(messages) {
    const systemMessages = messages
      .filter(m => m.role === "system")
      .map(m => m.content)
      .filter(Boolean);
    return systemMessages.length > 0 ? systemMessages.join("\n\n") : undefined;
  }

  convertMessagesToContents(messages) {
    const contents = [];
    let pendingParts = [];
    let currentRole = null;

    const flush = () => {
      if (pendingParts.length > 0 && currentRole) {
        contents.push({ role: currentRole, parts: pendingParts });
        pendingParts = [];
      }
    };

    for (const msg of messages) {
      if (msg.role === "system") continue;

      if (msg.role === "user") {
        if (currentRole && currentRole !== "user") flush();
        currentRole = "user";
        if (msg.content) {
          pendingParts.push({ text: msg.content });
        }
        if (msg.images && msg.images.length > 0) {
          for (const img of msg.images) {
            if (img.image_url && img.image_url.url) {
              const url = img.image_url.url;
              if (url.startsWith("data:")) {
                const match = url.match(/^data:([^;]+);base64,(.+)$/);
                if (match) {
                  pendingParts.push({ inlineData: { mimeType: match[1], data: match[2] } });
                }
              }
            }
          }
        }
      } else if (msg.role === "assistant") {
        if (currentRole && currentRole !== "model") flush();
        currentRole = "model";
        if (msg.content) {
          pendingParts.push({ text: msg.content });
        }
      } else if (msg.role === "assistant_with_tool") {
        if (currentRole && currentRole !== "model") flush();
        currentRole = "model";
        const kwargs = msg.content && msg.content.kwargs ? msg.content.kwargs : {};
        if (kwargs.content) {
          pendingParts.push({ text: kwargs.content });
        }
        for (const tc of kwargs.tool_calls || []) {
          const parseArgs = (args) => {
            if (!args || args === "") return {};
            if (typeof args === "string") { try { return JSON.parse(args); } catch { return {}; } }
            return args;
          };
          pendingParts.push({
            functionCall: { name: tc.name, args: parseArgs(tc.args) }
          });
        }
      } else if (msg.role === "tool") {
        if (currentRole && currentRole !== "user") flush();
        currentRole = "user";
        let responseContent;
        try {
          responseContent = typeof msg.content === "string" ? JSON.parse(msg.content) : msg.content;
        } catch {
          responseContent = { result: msg.content };
        }
        pendingParts.push({
          functionResponse: {
            name: msg.name || "unknown",
            response: responseContent
          }
        });
      }
    }

    flush();
    return contents;
  }

  async execute(messages, options = {}) {
    const instructions = this.extractInstructions(messages);
    const contents = this.convertMessagesToContents(messages);

    const modelPath = this.modelName.startsWith("models/") ? this.modelName : `models/${this.modelName}`;

    const params = { model: modelPath, contents };
    if (instructions) {
      params.systemInstruction = { parts: [{ text: instructions }] };
    }
    if (this.tools.length > 0) {
      params.tools = [{ functionDeclarations: this.tools }];
      params.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
    }

    const response = await this._request(params, options.streaming ? options.tokenCallback : null);
    const usage = this.extractTokenUsage(response);

    // Check for function calls
    const functionCalls = [];
    for (const candidate of response.candidates || []) {
      for (const part of candidate.content?.parts || []) {
        if (part.functionCall) {
          functionCalls.push(part.functionCall);
        }
      }
    }

    if (functionCalls.length > 0) {
      const callTimestamp = Date.now();

      messages.push({
        role: "assistant_with_tool",
        content: {
          kwargs: {
            content: this._extractText(response),
            tool_calls: functionCalls.map((fc, idx) => ({
              id: `gemini-${callTimestamp}-${idx}`,
              name: fc.name,
              args: fc.args || {}
            }))
          }
        },
        timestamp: callTimestamp
      });

      const toolNames = functionCalls.map(fc => fc.name).join(", ");
      console.error(`[tools] calling: ${toolNames}`);

      const toolResults = await Promise.all(
        functionCalls.map(async (fc, idx) => {
          const argsPreview = fc.args ? JSON.stringify(fc.args).slice(0, 200) : "";
          console.error(`[tool] ${fc.name}(${argsPreview})`);
          const startTime = Date.now();
          try {
            const tool = this.toolMap[fc.name];
            if (!tool) {
              console.error(`[tool] ${fc.name} => unknown tool`);
              return { role: "tool", content: `Error: Unknown tool "${fc.name}"`, tool_call_id: `gemini-${callTimestamp}-${idx}`, name: fc.name, timestamp: Date.now() };
            }
            const result = await tool.invoke(fc.args || {});
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const preview = typeof result === "string" ? result.slice(0, 100) : "";
            console.error(`[tool] ${fc.name} => done (${elapsed}s) ${preview}`);
            return { role: "tool", content: typeof result === "string" ? result : JSON.stringify(result), tool_call_id: `gemini-${callTimestamp}-${idx}`, name: fc.name, timestamp: Date.now() };
          } catch (error) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.error(`[tool] ${fc.name} => error (${elapsed}s): ${error.message}`);
            return { role: "tool", content: `Error executing tool "${fc.name}": ${error.message}`, tool_call_id: `gemini-${callTimestamp}-${idx}`, name: fc.name, timestamp: Date.now() };
          }
        })
      );

      messages.push(...toolResults);

      const nextResult = await this.execute(messages, options);
      nextResult.usage.input += usage.input;
      nextResult.usage.output += usage.output;
      nextResult.usage.cached += usage.cached;
      return nextResult;
    }

    return { answer: this._extractText(response), usage };
  }

  async _request(params, tokenCallback) {
    await this.tokenManager.refresh();
    const token = this.tokenManager.accessToken;

    const url = `${this.baseUrl}:streamGenerateContent?alt=sse`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gemini CLI API error (${response.status}): ${text}`);
    }

    let accumulatedText = "";
    const functionCallsMap = new Map();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let usageMetadata = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data || data === "[DONE]") continue;

        try {
          const event = JSON.parse(data);

          for (const candidate of event.candidates || []) {
            for (const part of candidate.content?.parts || []) {
              if (part.text) {
                accumulatedText += part.text;
                if (tokenCallback) tokenCallback(part.text);
              }
              if (part.functionCall) {
                const key = `${part.functionCall.name}-${functionCallsMap.size}`;
                functionCallsMap.set(key, part.functionCall);
              }
            }
          }

          if (event.usageMetadata) {
            usageMetadata = event.usageMetadata;
          }
          if (event.error) {
            throw new Error(`Gemini error: ${event.error.message || JSON.stringify(event.error)}`);
          }
        } catch (e) {
          if (e.message.startsWith("Gemini")) throw e;
        }
      }
    }

    const parts = [];
    if (accumulatedText) {
      parts.push({ text: accumulatedText });
    }
    for (const fc of functionCallsMap.values()) {
      parts.push({ functionCall: fc });
    }

    return {
      candidates: [{
        content: { role: "model", parts },
        finishReason: functionCallsMap.size > 0 ? "FUNCTION_CALL" : "STOP"
      }],
      usageMetadata: usageMetadata || {}
    };
  }

  _extractText(response) {
    let text = "";
    for (const candidate of response.candidates || []) {
      for (const part of candidate.content?.parts || []) {
        if (part.text) text += part.text;
      }
    }
    return text;
  }

  extractTokenUsage(response) {
    const usage = response.usageMetadata || {};
    return {
      input: usage.promptTokenCount || 0,
      output: usage.candidatesTokenCount || 0,
      cached: usage.cachedContentTokenCount || 0
    };
  }
}

function convertSchemaToGemini(schema) {
  if (!schema || typeof schema !== "object") return schema;
  const result = { ...schema };
  if (result.type) {
    result.type = result.type.toUpperCase();
  }
  if (result.properties) {
    const converted = {};
    for (const [key, value] of Object.entries(result.properties)) {
      converted[key] = convertSchemaToGemini(value);
    }
    result.properties = converted;
  }
  if (result.items) {
    result.items = convertSchemaToGemini(result.items);
  }
  return result;
}
