import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import { TokenManager } from "./TokenRefresh.js";

const CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex/responses";

export class CodexApi {
  constructor(config = {}) {
    const { model, refreshToken, apiKey, accountId } = config;
    this.modelName = model || "gpt-5.3-codex";
    this.accountId = accountId || "";
    this.tokenManager = new TokenManager({ apiKey, refreshToken, codexAuth: true });
    this.tools = [];
    this.toolMap = {};
  }

  bindTools(tools) {
    for (const tool of tools) {
      const openAiTool = convertToOpenAITool(tool);
      const fn = openAiTool.function;
      // Truncate long descriptions for codex endpoint compatibility
      let description = fn.description || "";
      if (description.length > 1024) {
        description = description.slice(0, 1024).replace(/\n[^\n]*$/, "") + "\n...";
      }
      // Clean parameters to match codex Responses API format
      const params = { ...fn.parameters };
      delete params.$schema;
      delete params.additionalProperties;
      this.tools.push({
        type: "function",
        name: fn.name,
        description,
        parameters: params,
        strict: false
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

  convertMessagesToInput(messages) {
    const items = [];
    for (const msg of messages) {
      if (msg.role === "system") continue;

      if (msg.role === "user") {
        if (msg.images && msg.images.length > 0) {
          const content = [{ type: "input_text", text: msg.content || "" }];
          for (const img of msg.images) {
            if (img.image_url && img.image_url.url) {
              content.push({ type: "input_image", image_url: img.image_url.url });
            }
          }
          items.push({ role: "user", content });
        } else {
          items.push({ role: "user", content: msg.content || "" });
        }
      } else if (msg.role === "assistant") {
        items.push({ role: "assistant", content: msg.content || "" });
      } else if (msg.role === "assistant_with_tool") {
        const kwargs = msg.content && msg.content.kwargs ? msg.content.kwargs : {};
        for (const tc of kwargs.tool_calls || []) {
          items.push({
            type: "function_call",
            call_id: tc.id,
            name: tc.name,
            arguments: typeof tc.args === "string" ? tc.args : JSON.stringify(tc.args)
          });
        }
      } else if (msg.role === "tool") {
        items.push({
          type: "function_call_output",
          call_id: msg.tool_call_id,
          output: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
        });
      }
    }
    return items;
  }

  async execute(messages, options = {}) {
    const instructions = this.extractInstructions(messages);
    const input = this.convertMessagesToInput(messages);
    const params = {
      model: this.modelName,
      input,
      stream: true,
      store: false
    };
    if (instructions) params.instructions = instructions;
    if (this.tools.length > 0) {
      params.tools = this.tools;
      params.tool_choice = "auto";
    }

    const response = await this._request(params, options.streaming ? options.tokenCallback : null);
    const usage = this.extractTokenUsage(response);
    const functionCalls = (response.output || []).filter(item => item.type === "function_call");

    if (functionCalls.length > 0) {
      const parseArgs = (args) => {
        if (!args || args === "") return {};
        try { return JSON.parse(args); } catch { return {}; }
      };

      messages.push({
        role: "assistant_with_tool",
        content: {
          kwargs: {
            content: response.output_text || "",
            tool_calls: functionCalls.map(fc => ({
              id: fc.call_id,
              name: fc.name,
              args: parseArgs(fc.arguments)
            }))
          }
        },
        timestamp: Date.now()
      });

      const toolResults = await Promise.all(
        functionCalls.map(async (fc) => {
          try {
            const tool = this.toolMap[fc.name];
            if (!tool) {
              return { role: "tool", content: `Error: Unknown tool "${fc.name}"`, tool_call_id: fc.call_id, name: fc.name, timestamp: Date.now() };
            }
            const result = await tool.invoke(parseArgs(fc.arguments));
            return { role: "tool", content: typeof result === "string" ? result : JSON.stringify(result), tool_call_id: fc.call_id, name: fc.name, timestamp: Date.now() };
          } catch (error) {
            return { role: "tool", content: `Error executing tool "${fc.name}": ${error.message}`, tool_call_id: fc.call_id, name: fc.name, timestamp: Date.now() };
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

    return { answer: response.output_text || "", usage };
  }

  async _request(params, tokenCallback) {
    await this.tokenManager.refresh();
    const token = this.tokenManager.accessToken;

    const headers = {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
      "OpenAI-Beta": "responses=experimental"
    };
    if (this.accountId) {
      headers["chatgpt-account-id"] = this.accountId;
    }

    const response = await fetch(CODEX_BASE_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Codex API error (${response.status}): ${text}`);
    }

    let completedResponse = null;
    let accumulatedText = "";
    const functionCallsMap = new Map();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

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

          if (event.type === "response.output_text.delta") {
            accumulatedText += event.delta || "";
            if (tokenCallback) tokenCallback(event.delta);
          }
          if (event.type === "response.output_item.added" && event.item && event.item.type === "function_call") {
            const item = event.item;
            const key = item.id || item.call_id;
            functionCallsMap.set(key, {
              type: "function_call",
              call_id: item.call_id || item.id,
              name: item.name,
              arguments: item.arguments || ""
            });
          }
          if (event.type === "response.function_call_arguments.delta") {
            const key = event.item_id || event.call_id;
            const fc = functionCallsMap.get(key);
            if (fc) {
              fc.arguments += event.delta || "";
            }
          }
          if (event.type === "response.function_call_arguments.done") {
            const key = event.item_id || event.call_id;
            const fc = functionCallsMap.get(key);
            if (fc) {
              fc.arguments = event.arguments || fc.arguments;
            }
          }
          if (event.type === "response.completed" || event.type === "response.done") {
            completedResponse = event.response;
          }
          if (event.type === "error") {
            throw new Error(`Codex error: ${event.message || JSON.stringify(event)}`);
          }
          if (event.type === "response.failed") {
            throw new Error(event.response?.error?.message || "Codex response failed");
          }
        } catch (e) {
          if (e.message.startsWith("Codex")) throw e;
        }
      }
    }

    if (!completedResponse) {
      completedResponse = { id: null, output: [], output_text: accumulatedText, usage: {} };
    }

    // Merge incrementally tracked function calls into the response output
    if (functionCallsMap.size > 0) {
      if (!completedResponse.output) completedResponse.output = [];
      for (const fc of functionCallsMap.values()) {
        const existing = completedResponse.output.find(
          item => item.type === "function_call" && item.call_id === fc.call_id
        );
        if (existing) {
          // Update with tracked arguments (completed response may have empty args)
          if (fc.arguments && fc.arguments !== "") {
            existing.arguments = fc.arguments;
          }
        } else {
          completedResponse.output.push(fc);
        }
      }
    }

    if (!completedResponse.output_text) {
      if (completedResponse.output) {
        completedResponse.output_text = completedResponse.output
          .filter(item => item.type === "message")
          .flatMap(item => (item.content || []).filter(c => c.type === "output_text").map(c => c.text))
          .join("");
      }
      if (!completedResponse.output_text) {
        completedResponse.output_text = accumulatedText;
      }
    }

    return completedResponse;
  }

  extractTokenUsage(response) {
    return {
      input: response.usage?.input_tokens || 0,
      output: response.usage?.output_tokens || 0,
      cached: response.usage?.input_tokens_details?.cached_tokens || 0
    };
  }
}
