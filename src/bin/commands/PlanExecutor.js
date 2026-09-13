import { PromptError } from "../../lib/Prompt.js";
import { readFile, asJson } from "../../lib/util/FileUtils.js";
import { buildAgentPrompt } from "./AskExecutor.js";

// PLAN: load conversation state from --history (+ an optional new user
// --question), run EXACTLY ONE LLM turn, and emit a structured JSON result to
// stdout. Does NOT execute tools and does NOT recurse — the assistant message
// (final answer or tool_calls) is checkpointed into --history so a fresh process
// can resume from it. Output shape:
//   {"status":"final","text":"..."}
//   {"status":"tool_calls","toolCalls":[{"id":"...","name":"...","arguments":{...}}]}
export async function planExecutor(params) {
  try {
    const { prompt, message, role } = await buildAgentPrompt(params);
    const result = await prompt.plan(message, params, role);
    console.log(JSON.stringify(result));
    prompt.close();
  } catch (error) {
    reportError(error, "planExecutor");
    throw error;
  }
}

// RESUME: given --history and a set of tool results (a JSON file path or inline
// JSON, shaped [{"id":"<toolCallId>","content":"<result>"}]), append them to
// history as correctly-paired tool messages, then perform EXACTLY ONE plan turn
// and emit the same structured JSON result. Resume is just plan preceded by
// injecting tool results — the same single-turn primitive.
export async function resumeExecutor(params) {
  try {
    const toolResults = await loadToolResults(params.toolResults);

    const { prompt, message, role } = await buildAgentPrompt(params);
    prompt.injectToolResults(toolResults);
    const result = await prompt.plan(message, params, role);
    console.log(JSON.stringify(result));
    prompt.close();
  } catch (error) {
    reportError(error, "resumeExecutor");
    throw error;
  }
}

// Tool results arrive as either an inline JSON string (starts with [ or {) or a
// path to a JSON file. Normalize to an array.
async function loadToolResults(toolResults) {
  if (toolResults === undefined || toolResults === null) return [];
  if (Array.isArray(toolResults)) return toolResults;

  if (typeof toolResults === "object") return [toolResults];

  if (typeof toolResults === "string") {
    const trimmed = toolResults.trim();
    if (trimmed === "") return [];
    let parsed;
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      parsed = JSON.parse(trimmed);
    } else {
      parsed = await readFile(trimmed).then(asJson());
    }
    if (Array.isArray(parsed)) return parsed;
    return parsed ? [parsed] : [];
  }

  return [];
}

function reportError(error, label) {
  if (error instanceof PromptError) {
    console.error("Prompt error:", error.message);
  } else {
    console.error(`Error in ${label}:`);
    console.error("Message:", error.message);
    console.error("Stack trace:");
    console.error(error.stack);
  }
}
