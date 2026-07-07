import fs from "node:fs";
import path from "node:path";

import { ChatPromptTemplate } from "@langchain/core/prompts";
import { getModel } from "./Models.js";
import {
  deserializeMessage,
  recoverTruncatedImageArgs,
  simplifyMessagesForHistory,
  collapseSystemMessages
} from "./MessageFormat.js";
import { readFile, asJson } from "./util/FileUtils.js";
import { buildZodSchema } from "./util/SchemaUtils.js";
import mime from "mime-types";
import Tools, { createTools } from "./Tools.js";
import { CONSEQUENTIAL_TOOLS as CONSEQUENTIAL_POLICY_TOOLS } from "./Policy.js";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { shouldCompact, compactMessages } from "./Compaction.js";
import { CodexApi } from "./CodexApi.js";
import { loadCodexAuth } from "./TokenRefresh.js";
import { LoopBudget } from "./LoopBudget.js";
import { HistoryLock, writeFileAtomic } from "./HistoryLock.js";
import { parseParkSignal, isParkSignal, emitPendingMarker, findParkedResult, applyPendingResolution } from "./HumanInLoop.js";
import { EventStream } from "./Events.js";

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
    // Loop budget caps the tool-execution loop (iterations always, tokens/time
    // optionally). Always present so the loop can never run uncapped.
    this.budget = new LoopBudget(options.budget || {});
    this.budgetExceeded = null;
    // Session lock config for the history file. { waitMs, staleMs, enabled }.
    // Acquired lazily in history() once a history file is known; held for the whole
    // run so concurrent asks/compaction on the same file can never clobber it.
    this.lockConfig = options.lock || null;
    this.historyLock = null;
    // Structured JSON event stream. Always present (a disabled stream when no sink is
    // configured) so every emit site is a cheap no-op unless the supervisor opted in.
    this.events = options.events || new EventStream(null);
    // Loop round counter (one model request/response per round). Distinct from
    // budget.iterations, which only counts rounds that actually run tools.
    this.round = 0;
    this.messages = [];
    this.tokenUsage = { input: 0, output: 0, cached: 0, total: 0 };
    this.toolCallCount = 0;
    // Human-in-the-loop parking state. `pendingQuestion` is a durable record of a
    // question/permission the agent parked on when no TTY was available; `paused` marks
    // that the current turn ended parked (the executable exits with PENDING_EXIT_CODE).
    this.pendingQuestion = null;
    this.paused = false;
    this.mcpClient = null;
    this.apiType = config.api || "chat";
    // Best-effort model identifier for observability events.
    this.modelId = (config.config && config.config.model) || config.type || "openai";

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
    // Acquire the session lock BEFORE reading the file so the whole load+run is
    // guarded. On contention this throws a LockError (fail fast) unless --waitLock
    // opted into poll-waiting; the executor turns that into the lock exit code.
    await this.acquireHistoryLock();
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
      // Restore a parked question so this run can resolve it with the user's answer.
      if (historyData.pendingQuestion && typeof historyData.pendingQuestion === "object") {
        this.pendingQuestion = historyData.pendingQuestion;
      }
    }
  }

  // Acquire the per-history session lock. Idempotent: a run holds a single lock for
  // its whole lifetime. Set lockConfig.enabled = false to opt out entirely.
  async acquireHistoryLock() {
    if (!this.historyFile || this.historyLock) return;
    const cfg = this.lockConfig || {};
    if (cfg.enabled === false) return;
    const lock = new HistoryLock(this.historyFile, {
      waitMs: cfg.waitMs,
      staleMs: cfg.staleMs
    });
    await lock.acquire();
    this.historyLock = lock;
  }

  // Release the session lock if held. Idempotent; safe from finally/close paths.
  releaseHistoryLock() {
    if (!this.historyLock) return;
    this.historyLock.release();
    this.historyLock = null;
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

    // Fresh loop budget for this ask (counters + wall-clock start).
    this.budget.reset();
    this.budgetExceeded = null;
    this.round = 0;

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

    let extraSystem = null;
    if (this.outputSchema) {
      const schemaJson = JSON.stringify(this.outputSchema, null, 2);
      extraSystem = `You MUST respond with ONLY a valid JSON object. No other text, no markdown, no code blocks, no explanation.\nYour response must match this schema:\n${schemaJson}`;
    }

    // Collapse every system message (base instructions, user instructions, and the
    // optional output-schema format instructions) into a SINGLE leading system
    // message. Providers such as Anthropic reject any system message that is not the
    // very first message ("System messages are only permitted as the first passed
    // message") — and reject multiple consecutive leading system messages too. A
    // single leading system message is accepted by every provider.
    const messages = collapseSystemMessages(this.messages, extraSystem);

    const promptTemplate = ChatPromptTemplate.fromMessages(
      messages.map((message, index) => deserializeMessage(message, index))
    );

    let chain = promptTemplate.pipe(this.model);

    // One loop round = one model request/response (and, if tools are requested, the
    // round of tool executions that follows).
    const round = ++this.round;
    this.events.emit("iteration.start", { round });

    try {
      let response;

      this.events.emit("model.request", { round, model: this.modelId });
      const usageBefore = { ...this.tokenUsage };

      if (this.streaming && !this.outputSchema) {
        response = await this._streamResponse(chain);
      } else {
        response = await chain.invoke();
      }

      const tokensBefore = usageBefore.total;
      this._accumulateTokenUsage(response);
      this.budget.addConsumed(this.tokenUsage.total - tokensBefore);

      const hasToolCalls = !!(response.tool_calls && response.tool_calls.length > 0);
      this.events.emit("model.response", {
        round,
        model: this.modelId,
        tokensIn: this.tokenUsage.input - usageBefore.input,
        tokensOut: this.tokenUsage.output - usageBefore.output,
        tokensCached: this.tokenUsage.cached - usageBefore.cached,
        toolCalls: hasToolCalls ? response.tool_calls.map(tc => tc.name) : []
      });

      if (response.tool_calls && response.tool_calls.length > 0) {
        // Enforce the loop budget BEFORE running this round of tools. If a limit is
        // reached we stop cleanly rather than recursing forever: no dangling tool
        // calls are appended, the conversation and token usage are persisted, and a
        // budget-exceeded note is returned as the answer.
        const budgetReason = this.budget.recordIteration();
        if (budgetReason) {
          return this._terminateOnBudget(budgetReason, response);
        }

        this.messages.push({ role: "assistant_with_tool", content: response, timestamp: Date.now() });
        this.saveHistory();

        // Pre-process saveImage tool calls to extract full base64 from previous tool responses
        recoverTruncatedImageArgs(response.tool_calls, this.messages);

        // Execute all tool calls in parallel
        const toolNames = response.tool_calls.map(tc => tc.name).join(", ");
        console.error(`[tools] calling: ${toolNames}`);
        const toolResults = await Promise.all(
          response.tool_calls.map(async (toolCall) => {
            const argsPreview = typeof toolCall.args === "object" ? JSON.stringify(toolCall.args).slice(0, 200) : "";
            console.error(`[tool] ${toolCall.name}(${argsPreview})`);
            const startTime = Date.now();
            this.events.emit("tool.start", {
              round,
              tool: toolCall.name,
              toolCallId: toolCall.id,
              args: argsPreview
            });
            try {
              const tool = this.tools[toolCall.name];
              if (!tool) {
                console.error(`[tool] ${toolCall.name} => unknown tool`);
                this.events.emit("tool.end", {
                  round,
                  tool: toolCall.name,
                  toolCallId: toolCall.id,
                  ok: false,
                  durationMs: Date.now() - startTime,
                  error: "unknown tool"
                });
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

              // Human-in-the-loop park signal: the tool needs a human answer but there
              // is no TTY. Stash the record (with this call's id) and store a readable
              // placeholder as the tool result so the message history stays valid; the
              // engine terminates the turn after collecting all results.
              const parkRecord = parseParkSignal(toolResponse);
              if (parkRecord) {
                parkRecord.toolCallId = toolCall.id;
                console.error(`[tool] ${toolCall.name} => parked (awaiting user response)`);
                this.events.emit("tool.end", {
                  round,
                  tool: toolCall.name,
                  toolCallId: toolCall.id,
                  ok: true,
                  durationMs: Date.now() - startTime,
                  parked: true
                });
                return {
                  role: "tool",
                  content: `[Paused — awaiting the user's answer to: ${parkRecord.question}]`,
                  tool_call_id: toolCall.id,
                  name: toolCall.name,
                  timestamp: Date.now(),
                  parked: parkRecord
                };
              }

              const preview = typeof toolResponse === "string" ? toolResponse.slice(0, 100) : "";
              console.error(`[tool] ${toolCall.name} => done (${elapsed}s) ${preview}`);
              this.events.emit("tool.end", {
                round,
                tool: toolCall.name,
                toolCallId: toolCall.id,
                ok: true,
                durationMs: Date.now() - startTime
              });
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
              this.events.emit("tool.end", {
                round,
                tool: toolCall.name,
                toolCallId: toolCall.id,
                ok: false,
                durationMs: Date.now() - startTime,
                error: error.message
              });
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

        // If any tool parked (needs a human answer, no TTY), suspend the turn: record
        // the pending question durably, emit the structured marker for a supervisor, and
        // stop — do NOT recurse. The next run resolves it via resolvePending().
        const parkedEntry = findParkedResult(toolResults);
        if (parkedEntry) {
          this.pendingQuestion = parkedEntry.parked;
          this.paused = true;
          this.saveHistory(true);
          emitPendingMarker(this.pendingQuestion);
          this.events.emit("question.parked", {
            round,
            kind: this.pendingQuestion.kind,
            tool: this.pendingQuestion.tool,
            question: this.pendingQuestion.question,
            key: this.pendingQuestion.key
          });
          return "⏸ Paused: waiting for the user to answer a pending question. Run the agent again with the answer to continue.";
        }

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
          const messagesBefore = this.messages.length;
          try {
            this.messages = await compactMessages(this.messages, compactionModel, {
              keepLastMessages: this.compactionConfig.keepLastMessages || 6,
              promptFile: this.compactionConfig.promptFile
            });
            this.compacted = true;
            this.events.emit("compaction", {
              round,
              promptTokens,
              messagesBefore,
              messagesAfter: this.messages.length
            });
          } catch (err) {
            console.error(`[compact] Warning: ${err.message}`);
          }
        }
      }

      this.saveHistory(true);

      return answer;
    } catch (e) {
      this.events.emit("error", { round, message: e.message });
      this.saveHistory(true);
      throw new PromptError(e.message, e);
    }
  }

  // Clean termination when the loop budget trips. Appends a final assistant note
  // describing what was in progress, persists history + token usage, records the
  // reason on this.budgetExceeded (so the caller can set a non-zero exit code), and
  // returns the note as the answer. Does NOT append the pending assistant_with_tool
  // message — that would leave dangling tool calls and corrupt the next turn.
  _terminateOnBudget(reason, response) {
    const pendingTools = (response && Array.isArray(response.tool_calls))
      ? response.tool_calls.map(tc => tc.name).join(", ")
      : "";
    const partial = (response && typeof response.content === "string")
      ? response.content
      : (response && Array.isArray(response.content)
        ? response.content.filter(c => c.type === "text").map(c => c.text).join("")
        : "");

    const note = this.budget.terminationNote(reason, { pendingTools, partial });
    this.budgetExceeded = {
      reason,
      pendingTools,
      iterations: this.budget.iterations,
      tokens: this.budget.consumed,
      elapsedMs: this.budget.elapsed()
    };
    console.error(`[budget] ${reason} — stopping loop after ${Math.max(0, this.budget.iterations - 1)} completed iteration(s)`);
    this.events.emit("budget.exceeded", {
      round: this.round,
      reason,
      iterations: this.budget.iterations,
      tokens: this.budget.consumed,
      elapsedMs: this.budget.elapsed(),
      pendingTools: pendingTools ? pendingTools.split(", ") : []
    });

    this.messages.push({ role: "assistant", content: note, timestamp: Date.now() });
    this.saveHistory(true);
    return note;
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
    // The Codex loop lives inside CodexApi.execute (its own internal tool loop), so
    // events here are emitted at run granularity rather than per internal round.
    const round = ++this.round;
    this.events.emit("iteration.start", { round });
    try {
      this.events.emit("model.request", { round, model: this.modelId });
      const result = await this.codexApi.execute(this.messages, {
        streaming: this.streaming && !this.outputSchema,
        tokenCallback: this.tokenCallback,
        outputSchema: this.outputSchema,
        budget: this.budget
      });

      this.tokenUsage.input += result.usage.input || 0;
      this.tokenUsage.output += result.usage.output || 0;
      this.tokenUsage.cached += result.usage.cached || 0;
      this.tokenUsage.total += (result.usage.input || 0) + (result.usage.output || 0);

      this.events.emit("model.response", {
        round,
        model: this.modelId,
        tokensIn: result.usage.input || 0,
        tokensOut: result.usage.output || 0,
        tokensCached: result.usage.cached || 0
      });

      // The Codex loop lives inside CodexApi.execute; when it trips the budget it
      // returns a budget-exceeded marker answer instead of recursing. Persist token
      // usage (already accumulated above) + the note and surface the reason without
      // running outputSchema parsing on the note.
      if (result.budgetExceeded) {
        this.budgetExceeded = result.budgetExceeded;
        console.error(`[budget] ${result.budgetExceeded.reason} — stopping Codex loop after ${Math.max(0, (result.budgetExceeded.iterations || this.budget.iterations) - 1)} completed iteration(s)`);
        this.events.emit("budget.exceeded", {
          round,
          reason: result.budgetExceeded.reason,
          iterations: result.budgetExceeded.iterations || this.budget.iterations,
          tokens: result.budgetExceeded.tokens || this.budget.consumed,
          elapsedMs: result.budgetExceeded.elapsedMs || this.budget.elapsed()
        });
        this.messages.push({ role: "assistant", content: result.answer, timestamp: Date.now() });
        this.saveHistory(true);
        return result.answer;
      }

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
      this.events.emit("error", { round, message: e.message });
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
      const simplifiedMessages = simplifyMessagesForHistory(this.messages);

      if (simplifiedMessages.length === 0) return;

      const historyObject = {
        messages: simplifiedMessages,
        tokenUsage: this.tokenUsage
      };
      // Persist a parked question so a later run can resolve it. Cleared once resolved.
      if (this.pendingQuestion) {
        historyObject.pendingQuestion = this.pendingQuestion;
      }
      const data = JSON.stringify(historyObject);
      if (data.length < 3) return;

      // The old size heuristic ("skip write if the on-disk file is >1.5x larger")
      // was a best-effort guard against a concurrent process clobbering the file.
      // The session lock (acquired in history(), held for the whole run) now makes
      // that guard redundant — no other run can be writing this file — so it is
      // removed. Writes go through writeFileAtomic (temp file + rename) so a reader
      // or a crashing writer never observes a half-written history, and each save
      // refreshes the lock so a long, actively-working run is never mistaken for a
      // stale one.
      writeFileAtomic(this.historyFile, data);
      if (this.historyLock) this.historyLock.touch();
    } catch (error) {
      console.error("Error writing history file:", error.message);
    }
  }

  // Resolve a parked question with the user's answer, feed it to the waiting tool call,
  // and continue the agent loop. For a question (askUser) the answer text becomes the
  // tool result; for a permission the answer decides allow/deny and, when allowed, the
  // original tool (e.g. executeAux4) is re-invoked so it actually runs. Returns the
  // agent's final answer (or a fresh pause message if it parks again).
  async resolvePending(answer) {
    const pending = this.pendingQuestion;
    if (!pending) return null;

    const resolutions = { [pending.key]: { answer } };

    // Rebuild the tools with the resolution so the parked ask-gate is satisfied. Policy
    // wrapping is intentionally dropped: the original (parked) call already passed the
    // policy; this re-invocation only completes it and must not be double-counted.
    const resumeToolsConfig = { ...this.toolsConfig, resolutions };
    delete resumeToolsConfig.policy;
    delete resumeToolsConfig.getUsage;
    const tools = createTools(resumeToolsConfig);

    let resolvedResult;
    const tool = tools[pending.tool];
    if (tool) {
      try {
        resolvedResult = await tool.invoke(pending.args || {});
      } catch (error) {
        resolvedResult = `Error resolving the parked ${pending.tool} call: ${error.message}`;
      }
    } else {
      resolvedResult = `User responded: ${answer}`;
    }

    // Should never re-park (the resolution grants the request); guard defensively.
    if (isParkSignal(resolvedResult)) {
      resolvedResult = "[The parked request could not be resolved automatically.]";
    }

    // Feed the result to the waiting tool call in the message history.
    applyPendingResolution(this.messages, pending.toolCallId, resolvedResult);

    this.pendingQuestion = null;
    this.paused = false;
    this.saveHistory(true);

    const answerText = await this.execute();
    if (this.callback) {
      this.callback(`${answerText}`);
    }
    return answerText;
  }

  // Re-emit the pending-question marker (e.g. when resumed with no answer available) so
  // a supervisor is reminded the agent is still waiting.
  reemitPending() {
    if (!this.pendingQuestion) return;
    this.paused = true;
    emitPendingMarker(this.pendingQuestion);
  }

  async close() {
    // Release the session lock first so it is freed on every close path, even if
    // there is no MCP client to tear down.
    this.releaseHistoryLock();
    if (!this.mcpClient) return;

    await this.mcpClient.close();
    this.mcpClient = null;
  }
}

// `collapseSystemMessages` now lives in MessageFormat.js (importable without Prompt's
// heavy transitive deps, so it can be unit-tested directly). Re-exported here (from the
// binding imported at the top) to keep the historical `Prompt.js` import path working.
export { collapseSystemMessages };

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
