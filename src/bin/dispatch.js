import { addDocumentExecutor } from "./commands/AddDocumentExecutor.js";
import { searchExecutor } from "./commands/SearchExecutor.js";
import { forgetExecutor } from "./commands/ForgetExecutor.js";
import { askExecutor } from "./commands/AskExecutor.js";
import { planExecutor, resumeExecutor } from "./commands/PlanExecutor.js";
import { runToolExecutor } from "./commands/RunToolExecutor.js";
import { imageExecutor } from "./commands/ImageExecutor.js";
import { historyExecutor } from "./commands/HistoryExecutor.js";
import { compactExecutor } from "./commands/CompactExecutor.js";
import { summarizeExecutor } from "./commands/SummarizeExecutor.js";
import { rememberExecutor } from "./commands/RememberExecutor.js";
import { modelsExecutor } from "./commands/ModelsExecutor.js";
import { policyCheckExecutor } from "./commands/PolicyCheckExecutor.js";
import { policyResolveExecutor } from "./commands/PolicyResolveExecutor.js";

export function parsePolicyArg(value) {
  if (!value || value.trim() === "" || value.trim() === "{}") return null;
  try { return JSON.parse(value.trim()); } catch { return null; }
}

function commonAgentParams(args) {
  return {
    baseInstructions: args[1], instructions: args[2], role: args[3], history: args[4],
    outputSchema: args[5], question: args[6], image: args[7], context: args[8],
    model: JSON.parse(args[9] || "{}"), storage: args[10], stream: args[11],
    autoCompact: args[12], compaction: JSON.parse(args[13] || "{}"),
    bio: JSON.parse(args[14] || "{}"), permissions: JSON.parse(args[15] || "{}"),
    models: JSON.parse(args[16] || "{}"), useModel: args[17] || "", references: args[18] || "",
    skills: args[19] || "", policy: parsePolicyArg(args[20]), runId: args[21] || "",
    costs: JSON.parse(args[22] || "{}"),
    // Appended LAST on purpose: these args are positional, so new params must go
    // at the end or they shift every following arg (policy/runId/costs).
    tools: args[23] || "",
    packageDir: args.indexOf("--packageDir") !== -1 ? args[args.indexOf("--packageDir") + 1] : ""
  };
}

export async function dispatchCommand(args) {
  const command = args[0];
  if (!command) {
    console.log("Usage: aux4-agent <command> [options]");
    console.log("Commands: learn, search, forget, ask, plan, resume, run-tool, image, history, summarize, remember, compact, models, policy-check, policy-resolve");
    const error = new Error("Command is required");
    error.exitCode = 1;
    error.silent = true;
    throw error;
  }

  if (command === "learn") return await addDocumentExecutor({ storage: args[1], doc: args[2], type: args[3], embeddings: JSON.parse(args[4] || "{}") });
  if (command === "search") return await searchExecutor({ storage: args[1], format: args[2], source: args[3], limit: parseInt(args[4]), query: args[5], embeddings: JSON.parse(args[6] || "{}") });
  if (command === "forget") return await forgetExecutor({ storage: args[1], doc: args[2], embeddings: JSON.parse(args[3] || "{}") });
  if (command === "ask") return await askExecutor(commonAgentParams(args));
  if (command === "plan") return await planExecutor(commonAgentParams(args));
  if (command === "resume") return await resumeExecutor({ ...commonAgentParams(args), toolResults: args[24] || "" });
  if (command === "run-tool") {
    return await runToolExecutor({
      storage: args[1], permissions: JSON.parse(args[2] || "{}"), references: args[3] || "",
      skills: args[4] || "", tools: args[5] || "", toolCall: args[6] || ""
    });
  }
  if (command === "image") return await imageExecutor({ prompt: args[1], image: args[2], size: args[3], quality: args[4], context: args[5], model: JSON.parse(args[6] || "{}"), quantity: parseInt(args[7] || "1") });
  if (command === "history") return await historyExecutor({ historyFile: args[1], costIn: parseFloat(args[2]) || 0, costOut: parseFloat(args[3]) || 0, costCache: parseFloat(args[4]) || 0 });
  if (command === "summarize") return await summarizeExecutor({ historyFile: args[1], model: JSON.parse(args[2] || "{}"), models: JSON.parse(args[3] || "{}"), useModel: args[4] || "" });
  if (command === "remember") return await rememberExecutor({ historyFile: args[1], model: JSON.parse(args[2] || "{}"), models: JSON.parse(args[3] || "{}"), useModel: args[4] || "" });
  if (command === "compact") return await compactExecutor({ historyFile: args[1], model: JSON.parse(args[2] || "{}"), keepLastMessages: parseInt(args[3] || "6"), models: JSON.parse(args[4] || "{}"), useModel: args[5] || "" });
  if (command === "models") return await modelsExecutor({ models: JSON.parse(args[1] || "{}") });
  if (command === "policy-check") return await policyCheckExecutor({ policy: parsePolicyArg(args[1]), tool: args[2], action: args[3] || "", usage: JSON.parse(args[4] || "{}"), calls: args[5] || "0", runId: args[6] || "", costs: JSON.parse(args[7] || "{}") });
  if (command === "policy-resolve") return await policyResolveExecutor({ id: args[1], decision: args[2] });

  console.error(`Unknown command: ${command}`);
  console.log("Available commands: learn, search, forget, ask, plan, resume, run-tool, image, history, summarize, remember, compact, models, policy-check, policy-resolve");
  const error = new Error(`Unknown command: ${command}`);
  error.exitCode = 1;
  error.silent = true;
  throw error;
}

export function reportCommandError(error) {
  if (error?.silent) return;
  console.error(error?.message || String(error));
  console.error("Stack trace:");
  if (error?.stack) console.error(error.stack);
}
