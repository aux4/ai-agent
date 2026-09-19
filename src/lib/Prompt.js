import fs from "node:fs";
import path from "node:path";

import { SystemMessage, HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { getModel } from "./Models.js";
import { createAwsSigV4Fetch } from "./AwsSigV4Fetch.js";
import { readFile, asJson, ensureParentDirectorySync } from "./util/FileUtils.js";
import { buildZodSchema } from "./util/SchemaUtils.js";
import mime from "mime-types";
import { createTools } from "./Tools.js";
import { CONSEQUENTIAL_TOOLS as CONSEQUENTIAL_POLICY_TOOLS } from "./Policy.js";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { shouldCompact, compactMessages } from "./Compaction.js";
import { CodexApi } from "./CodexApi.js";
import { loadCodexAuth } from "./TokenRefresh.js";
import { GeminiCliApi } from "./GeminiCliApi.js";
import { loadGeminiAuth } from "./GeminiAuth.js";
import { internalTraceHeaders, timed } from "./Timing.js";
import { isWarmRuntimeRequest } from "./RuntimeContext.js";

const VARIABLE_REGEX = /\{([a-zA-Z0-9-_]+)\}/g;

// SFA-167: strip the raw LangChain AIMessage envelope before persisting an
// assistant_with_tool checkpoint. The provider round-trip only needs the
// assistant text plus each tool call's { id, name, args } — the lc/type/id
// constructor wrapper, response_metadata, usage_metadata, model_provider,
// model_name and invalid_tool_calls are pure storage tax (~10.5x measured).
// The normalized tool_calls array is what LangChain re-derives the outbound
// provider payload from, so keeping only these fields is a lossless round trip
// for the tool-calling path (proven by the plan/resume tests).
export function simplifyAssistantToolContent(response) {
  const toolCalls = Array.isArray(response && response.tool_calls) ? response.tool_calls : [];
  const rawContent = response ? response.content : "";
  return {
    content: typeof rawContent === "string" || Array.isArray(rawContent) ? rawContent : "",
    tool_calls: toolCalls.map(toolCall => ({
      id: toolCall.id,
      name: toolCall.name,
      args: toolCall.args || {},
      type: "tool_call"
    }))
  };
}

// SFA-159: how many identical failing tool-call rounds break the re-planning
// loop. N=3 tolerates one genuine retry (a model legitimately trying a call a
// second time after a transient failure) and only intervenes once the model has
// reissued the exact same command with zero new information a third time — an
// unambiguous non-productive loop. Cuts the observed 71-round / 6m44s storm to
// ~3 rounds while never tripping a legitimate retry-with-different-args.
const IDENTICAL_FAILURE_THRESHOLD = 3;

// Marker delimiting the synthetic loop-breaker guidance appended to a tool
// result. It is persisted with the result content and stripped before the
// content is compared, so the underlying result stays byte-identical across
// rounds — detection keeps working across the process boundary of the Step
// Functions plan/run-tool/resume cycle, where each turn rehydrates from disk.
const LOOP_GUIDANCE_MARKER = "\n\n[agent:repeated-failure] ";

// The tool_calls of an assistant_with_tool checkpoint, tolerating both the new
// stripped shape (content.tool_calls) and the legacy envelope (content.kwargs).
function checkpointToolCalls(message) {
  const content = (message && message.content) || {};
  return content.tool_calls || (content.kwargs && content.kwargs.tool_calls) || [];
}

// A stable signature (name + arguments) for a checkpoint's tool calls, used to
// tell "the model reissued the exact same command" from a legitimate different
// call. Returns null when the checkpoint has no tool calls.
function checkpointSignature(message) {
  const toolCalls = checkpointToolCalls(message);
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return null;
  return toolCalls
    .map(tc => `${tc && tc.name}:${JSON.stringify((tc && (tc.args ?? tc.arguments)) ?? {})}`)
    .join("|");
}

// The comparable result content — the guidance marker suffix (if any) is
// removed so an already-annotated round still matches the raw failures before
// it, keeping the streak intact across process boundaries.
function comparableToolContent(message) {
  const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content);
  const markerAt = content.indexOf(LOOP_GUIDANCE_MARKER);
  return markerAt === -1 ? content : content.slice(0, markerAt);
}

// Walk backward from the tail of the messages array counting consecutive
// tool-call rounds whose assistant checkpoint has an identical signature AND
// whose tool results are byte-identical (ignoring any guidance marker). This is
// what distinguishes "reissuing the same failing command verbatim" from a
// legitimate retry that changes arguments (different signature → streak breaks)
// or one that finally succeeds (different result → streak breaks).
function countIdenticalTrailingRounds(messages) {
  const rounds = [];
  let i = messages.length - 1;
  while (i >= 0) {
    const results = [];
    while (i >= 0 && messages[i].role === "tool") {
      results.unshift(comparableToolContent(messages[i]));
      i--;
    }
    if (i < 0 || messages[i].role !== "assistant_with_tool") break;
    const signature = checkpointSignature(messages[i]);
    if (!signature || results.length === 0) break;
    rounds.push({ signature, results: results.join("\u0000") });
    i--;
  }
  if (rounds.length === 0) return 0;
  const head = rounds[0];
  let count = 1;
  for (let k = 1; k < rounds.length; k++) {
    if (rounds[k].signature === head.signature && rounds[k].results === head.results) count++;
    else break;
  }
  return count;
}

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

    // SFA-183: durable, in-turn checkpointing. saveHistory() already writes the
    // transcript to --history after every message/tool round — that part was
    // never the gap. The gap is that those writes land on local disk (Lambda
    // /tmp), and cloud-file-sync only pushes AFTER the invocation returns, so a
    // container killed at its timeout never publishes the checkpoint. When a
    // checkpoint URL is configured we ALSO PUT the same payload straight to it
    // (a single presigned S3 object — no cloud-file-sync manifest is written or
    // read for this path, so it cannot hit the SFA-151 torn-manifest defect,
    // and it never contends with cloud-file-sync's own end-of-invocation push
    // over the same key). Both URLs are opaque HTTP endpoints (typically
    // short-lived presigned S3 URLs minted once per invocation by the caller) —
    // Prompt has no AWS SDK dependency and no knowledge of the storage behind
    // them. Unset (the default, and the only case for local/CLI use) => zero
    // added work on the hot path.
    this.checkpointPutUrl = options.checkpointPutUrl || process.env.AUX4_HISTORY_CHECKPOINT_PUT_URL || null;
    this.checkpointGetUrl = options.checkpointGetUrl || process.env.AUX4_HISTORY_CHECKPOINT_GET_URL || null;

    if (this.apiType === "codex") {
      const codexAuth = loadCodexAuth();
      if (!codexAuth) {
        throw new PromptError("Codex auth not found. Run 'codex login' first.");
      }
      this.codexApi = new CodexApi({ ...(config.config || {}), ...codexAuth });
    } else if (this.apiType === "gemini-cli") {
      const geminiAuth = loadGeminiAuth();
      if (!geminiAuth) {
        throw new PromptError("Gemini CLI auth not found. Run 'gemini' to authenticate first, or set GEMINI_CLI_REFRESH_TOKEN.");
      }
      this.geminiCliApi = new GeminiCliApi({ ...(config.config || {}), ...geminiAuth });
    } else {
      const Model = getModel(config.type || "openai");
      const chatConfig = { ...(config.config || {}) };
      if (!chatConfig.model && (config.type || "openai") === "openai") {
        chatConfig.model = "gpt-5-mini";
      }

      // `awsSigv4: { region, service }` targets an AWS OpenAI-compatible endpoint
      // (e.g. Bedrock). Requests are signed with the standard AWS credential chain, so no
      // API key is needed — the SDK still wants a non-empty apiKey, which is never sent.
      if (chatConfig.awsSigv4) {
        const { region, service, credentials } = chatConfig.awsSigv4;
        delete chatConfig.awsSigv4;
        chatConfig.apiKey = chatConfig.apiKey || "aws-sigv4";
        chatConfig.configuration = {
          ...(chatConfig.configuration || {}),
          fetch: createAwsSigV4Fetch({
            region: region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
            service,
            credentials
          })
        };
      }

      const baseURL = chatConfig.configuration?.baseURL;
      const traceHeaders = internalTraceHeaders(baseURL);
      if (Object.keys(traceHeaders).length > 0) {
        chatConfig.configuration = {
          ...(chatConfig.configuration || {}),
          defaultHeaders: {
            ...(chatConfig.configuration?.defaultHeaders || {}),
            ...traceHeaders
          }
        };
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
    const configuredTools = await timed(
      "package.discovery",
      // Always create request-local wrappers. The resident process reuses the
      // imported schemas/docs, never loop-detection or policy state.
      async () => createTools(this.toolsConfig),
      { cacheHit: isWarmRuntimeRequest() }
    );

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
    } else if (this.apiType === "gemini-cli") {
      this.geminiCliApi.bindTools(Object.values(configuredTools));
      if (mcpTools.length > 0) {
        this.geminiCliApi.bindTools(mcpTools);
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

    // SFA-183 resume: a fresh container (post-timeout retry, cold start) has no
    // local /tmp state to rehydrate from. If a durable checkpoint was
    // configured, pull it down and seed the local file BEFORE the normal local
    // read below, so "try again" continues from the last confirmed checkpoint
    // instead of restarting empty. A warm container that already has local
    // state skips this (it's already at least as fresh); a failed/empty pull
    // (nothing checkpointed yet, network error) falls through to the existing
    // empty-history behavior unchanged.
    if (this.checkpointGetUrl && !fs.existsSync(file)) {
      await this._pullCheckpoint(file);
    }

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

  async _pushUserMessage(text, params, role = "user") {
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
    await this.saveHistory();
  }

  async message(text, params, role = "user") {
    await this._pushUserMessage(text, params, role);

    const answer = await this.execute();

    if (this.callback) {
      this.callback(`${answer}`);
    }
  }

  // PLAN/RESUME primitive: run exactly ONE LLM turn WITHOUT executing tools and
  // WITHOUT recursing. execute() checkpoints the resulting assistant message
  // (final answer or tool_calls) into --history via its existing saveHistory
  // calls. Returns a structured result:
  //   { status: "final", text }
  //   { status: "tool_calls", toolCalls: [{ id, name, arguments }] }
  // This is strictly additive: it only runs when planOnly is set, so the classic
  // synchronous execute() path is byte-identical when plan mode is not requested.
  async plan(text, params, role = "user") {
    this.planOnly = true;
    if (text !== undefined && text !== null && text !== "") {
      await this._pushUserMessage(text, params, role);
    }
    return await this.execute();
  }

  // RESUME support: append externally-produced tool results to history as
  // provider-formatted tool messages, matching the tool_call ids emitted by the
  // most recent assistant_with_tool checkpoint. Mirrors the tool-result entry
  // shape execute() produces when it runs tools in-process, so the next plan turn
  // sees a correctly-paired assistant/tool exchange.
  async injectToolResults(toolResults = []) {
    let toolCalls = [];
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.role === "assistant_with_tool") {
        const content = m.content || {};
        toolCalls =
          content.tool_calls ||
          (content.kwargs && content.kwargs.tool_calls) ||
          [];
        break;
      }
    }
    const nameById = {};
    for (const tc of toolCalls) {
      if (tc && tc.id) nameById[tc.id] = tc.name;
    }
    for (const tr of toolResults) {
      const content = typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content);
      this.messages.push({
        role: "tool",
        content,
        tool_call_id: tr.id,
        name: nameById[tr.id] || tr.name || "unknown",
        timestamp: Date.now()
      });
    }
    this.guardRepeatedFailingToolCall();
    await this.saveHistory();
  }

  // SFA-159: break the "model reissues the same failing command verbatim" loop.
  // A tool error is just text to the model, so a broken command (e.g. a missing
  // required flag) can be re-planned unchanged indefinitely — one incident
  // reissued the identical failing call 71 times over 6m44s, burning ~72
  // inferences and baking 148 junk messages into durable history. Each Step
  // Functions turn is a separate CLI invocation rehydrating from --history, so
  // detection runs here — where tool results are assembled for the next model
  // turn — over the persisted, rehydrated messages. When the same tool call
  // (name+args) has produced the byte-identical result N times in a row, append
  // synthetic guidance to the latest tool result telling the model not to retry
  // verbatim, so it self-corrects instead of hard-cutting the plan mid-flight.
  guardRepeatedFailingToolCall() {
    const repeats = countIdenticalTrailingRounds(this.messages);
    if (repeats < IDENTICAL_FAILURE_THRESHOLD) return;

    const last = this.messages[this.messages.length - 1];
    if (!last || last.role !== "tool") return;
    if (typeof last.content === "string" && last.content.includes(LOOP_GUIDANCE_MARKER)) return;

    const rawContent = typeof last.content === "string" ? last.content : JSON.stringify(last.content);
    last.content =
      rawContent +
      LOOP_GUIDANCE_MARKER +
      `This exact tool call (same command and identical arguments) has now failed the same way ${repeats} times in a row. ` +
      "Do NOT call it again verbatim — retrying it unchanged will keep producing this identical failure. " +
      "Either report this error to the user and stop, or change your approach (correct the arguments, use different input, or try a different tool).";
  }

  async execute() {
    if (!Array.isArray(this.messages)) {
      throw new Error(`Messages is not an array: ${typeof this.messages}`);
    }

    if (this.apiType === "codex") {
      return await this._executeCodex();
    }

    if (this.apiType === "gemini-cli") {
      return await this._executeGeminiCli();
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
          // Two on-disk shapes are supported:
          //  - NEW (SFA-167): a stripped { content, tool_calls: [{ id, name, args, type }] }
          //    object — the LangChain envelope (lc/type/response_metadata/usage_metadata/
          //    invalid_tool_calls/model_*) is discarded before persisting.
          //  - OLD: the full serialized AIMessage envelope with a `kwargs` bag. Kept so
          //    existing conversations reload unchanged.
          // Both reconstruct the same AIMessage(content, tool_calls) the provider needs.
          const content = message.content || {};
          if (content.kwargs) {
            return new AIMessage({
              content: content.kwargs.content || "",
              tool_calls: content.kwargs.tool_calls || [],
              additional_kwargs: content.kwargs.additional_kwargs || {}
            });
          } else {
            return new AIMessage({
              content: content.content || "",
              tool_calls: content.tool_calls || [],
              additional_kwargs: content.additional_kwargs || {}
            });
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
        response = await timed("model.inference", () => this._streamResponse(chain));
      } else {
        response = await timed("model.inference", () => chain.invoke());
      }

      this._accumulateTokenUsage(response);

      if (response.tool_calls && response.tool_calls.length > 0) {
        this.messages.push({ role: "assistant_with_tool", content: simplifyAssistantToolContent(response), timestamp: Date.now() });
        await this.saveHistory();

        // PLAN mode: decide, don't act. The assistant tool-call message is now
        // checkpointed in --history; stop here without executing tools or
        // recursing. An external orchestrator runs the tools and calls resume
        // with their results for the next turn.
        if (this.planOnly) {
          return {
            status: "tool_calls",
            toolCalls: response.tool_calls.map(toolCall => ({
              id: toolCall.id,
              name: toolCall.name,
              arguments: toolCall.args || {}
            }))
          };
        }

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
        await this.saveHistory();

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

      // No tool calls AND nothing said is not an answer -- the model stopped generating
      // mid-task. Terminating here ends the run silently, which reads downstream as "the agent
      // decided it was finished" when it simply died. Retry once before believing it.
      if (!answer || !answer.trim()) {
        this._emptyRetried = (this._emptyRetried || 0) + 1;
        if (this._emptyRetried <= 2) {
          // Retrying the IDENTICAL context reproduces the identical stall -- observed failing
          // every time. Append a nudge so the next request differs from the one that died, and
          // give it two attempts rather than one.
          console.error(`[agent] empty response with no tool calls -- retry ${this._emptyRetried}/2`);
          this.messages.push({
            role: "user",
            content: "You returned nothing. Look at the last tool result, say what state you are in, and take the next action.",
            timestamp: Date.now()
          });
          return await this.execute();
        }
        answer = "The model returned an empty response three times in a row and the task was not completed.";
      } else {
        this._emptyRetried = 0;
      }

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

      await this.saveHistory(true);

      // PLAN mode: the model produced a final answer with no tool calls. The
      // assistant message is checkpointed; return the structured final result.
      if (this.planOnly) {
        return { status: "final", text: answer };
      }

      return answer;
    } catch (e) {
      await this.saveHistory(true);
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

      await this.saveHistory(true);
      return answer;
    } catch (e) {
      await this.saveHistory(true);
      throw new PromptError(e.message, e);
    }
  }

  async _executeGeminiCli() {
    try {
      const result = await this.geminiCliApi.execute(this.messages, {
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
              geminiCliApi: (!this.compactionConfig.model && this.apiType === "gemini-cli") ? this.geminiCliApi : null
            });
            this.compacted = true;
          } catch (err) {
            console.error(`[compact] Warning: ${err.message}`);
          }
        }
      }

      await this.saveHistory(true);
      return answer;
    } catch (e) {
      await this.saveHistory(true);
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

  async saveHistory(sync = false) {
    if (!this.historyFile) return;
    let data;
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

      data = JSON.stringify({
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
      // truncation when the process exits before the write completes. A new
      // durable workflow supplies a per-execution path whose parent does not
      // exist yet in a fresh Lambda container, so create it before writing.
      ensureParentDirectorySync(this.historyFile);
      fs.writeFileSync(this.historyFile, data);
    } catch (error) {
      console.error("Error writing history file:", error.message);
      return;
    }

    // SFA-183: mirror this checkpoint straight to durable storage, in addition
    // to the local write above — not instead of it (local stays the fast path
    // a warm container reads back from). Awaited by every call site so the
    // durable copy of THIS checkpoint is confirmed before the next tool call
    // or model turn starts; if the process is killed after that await returns,
    // only work that hasn't checkpointed yet is at risk, same as today's local
    // guarantee, now extended to survive the container dying. No-op when no
    // checkpoint URL is configured (the default).
    await this._pushCheckpoint(data);
  }

  // Best-effort durable push of an already-serialized checkpoint payload. A
  // single PUT of the whole transcript to a caller-supplied URL (normally a
  // short-lived presigned S3 URL minted once per invocation) — no manifest,
  // no cloud-file-sync involvement, so this path is structurally immune to the
  // SFA-151 torn-manifest defect (that bug lives entirely in cloud-file-sync's
  // manifest bookkeeping, which this never touches). Failure here does not
  // fail the turn: the local write already succeeded, and a warm-container
  // retry can still recover it; it's logged so it's visible, not silent.
  async _pushCheckpoint(data) {
    if (!this.checkpointPutUrl) return;
    try {
      const response = await fetch(this.checkpointPutUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: data
      });
      if (!response.ok) {
        console.error(`[checkpoint] durable push failed: HTTP ${response.status}`);
      }
    } catch (error) {
      console.error(`[checkpoint] durable push failed: ${error.message}`);
    }
  }

  // SFA-183 resume: pull the last durable checkpoint down into the local
  // --history path before the normal local read. Best-effort: no checkpoint
  // yet (fresh run, 404) or a transient fetch error both fall through to the
  // existing empty-history behavior — this can only add recovered state, never
  // remove it.
  async _pullCheckpoint(file) {
    try {
      const response = await fetch(this.checkpointGetUrl, { method: "GET" });
      if (!response.ok) {
        if (response.status !== 404) {
          console.error(`[checkpoint] durable pull failed: HTTP ${response.status}`);
        }
        return;
      }
      const data = await response.text();
      if (!data || data.length < 3) return;
      JSON.parse(data); // validate before trusting it as a history seed
      ensureParentDirectorySync(file);
      fs.writeFileSync(file, data);
    } catch (error) {
      console.error(`[checkpoint] durable pull failed: ${error.message}`);
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
