import OpenAI from "openai";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";

export class ResponsesApi {
  constructor(config = {}) {
    const { model, ...clientConfig } = config;
    this.modelName = model || "gpt-4o";
    this.client = new OpenAI(clientConfig);
    this.tools = [];
    this.toolMap = {};
    this.previousResponseId = null;
  }

  bindTools(tools) {
    for (const tool of tools) {
      const openAiTool = convertToOpenAITool(tool);
      // Responses API uses flattened format: { type, name, description, parameters }
      // convertToOpenAITool returns: { type: "function", function: { name, description, parameters } }
      const fn = openAiTool.function;
      this.tools.push({
        type: "function",
        name: fn.name,
        description: fn.description,
        parameters: fn.parameters,
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
        // Extract tool calls from the kwargs structure
        const kwargs = msg.content && msg.content.kwargs ? msg.content.kwargs : {};
        const toolCalls = kwargs.tool_calls || [];
        for (const tc of toolCalls) {
          items.push({
            type: "function_call",
            call_id: tc.id,
            name: tc.name,
            arguments: typeof tc.args === "string" ? tc.args : JSON.stringify(tc.args)
          });
        }
      } else if (msg.role === "tool") {
        const output = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        items.push({
          type: "function_call_output",
          call_id: msg.tool_call_id,
          output: output
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
      store: false
    };

    if (instructions) params.instructions = instructions;
    if (this.tools.length > 0) params.tools = this.tools;

    let response;
    if (options.streaming && !options.outputSchema) {
      response = await this._executeStreaming(params, options.tokenCallback);
    } else {
      response = await this._executeNonStreaming(params);
    }

    this.previousResponseId = response.id;
    const usage = this.extractTokenUsage(response);

    // Check for function calls
    const functionCalls = response.output.filter(item => item.type === "function_call");

    if (functionCalls.length > 0) {
      // Push assistant_with_tool message for history
      messages.push({
        role: "assistant_with_tool",
        content: {
          kwargs: {
            content: response.output_text || "",
            tool_calls: functionCalls.map(fc => ({
              id: fc.call_id,
              name: fc.name,
              args: JSON.parse(fc.arguments)
            }))
          }
        },
        timestamp: Date.now()
      });

      // Execute tools in parallel
      const toolResults = await Promise.all(
        functionCalls.map(async (fc) => {
          try {
            const tool = this.toolMap[fc.name];
            if (!tool) {
              return {
                role: "tool",
                content: `Error: Unknown tool "${fc.name}"`,
                tool_call_id: fc.call_id,
                name: fc.name,
                timestamp: Date.now()
              };
            }
            const args = JSON.parse(fc.arguments);
            const result = await tool.invoke(args);
            return {
              role: "tool",
              content: typeof result === "string" ? result : JSON.stringify(result),
              tool_call_id: fc.call_id,
              name: fc.name,
              timestamp: Date.now()
            };
          } catch (error) {
            console.error(`Tool "${fc.name}" failed: ${error.message}`);
            return {
              role: "tool",
              content: `Error executing tool "${fc.name}": ${error.message}`,
              tool_call_id: fc.call_id,
              name: fc.name,
              timestamp: Date.now()
            };
          }
        })
      );

      messages.push(...toolResults);

      // Recurse
      const nextResult = await this.execute(messages, options);
      nextResult.usage.input += usage.input;
      nextResult.usage.output += usage.output;
      nextResult.usage.cached += usage.cached;
      return nextResult;
    }

    return {
      answer: response.output_text || "",
      usage,
      previousResponseId: response.id
    };
  }

  async _executeNonStreaming(params) {
    return await this.client.responses.create(params);
  }

  async _executeStreaming(params, tokenCallback) {
    const stream = await this.client.responses.create({ ...params, stream: true });
    let completedResponse = null;

    for await (const event of stream) {
      if (event.type === "response.output_text.delta" && tokenCallback) {
        tokenCallback(event.delta);
      }
      if (event.type === "response.completed") {
        completedResponse = event.response;
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
