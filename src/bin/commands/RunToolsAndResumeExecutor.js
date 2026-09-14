import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { timed } from "../../lib/Timing.js";

const MAX_HISTORY_SEED_BYTES = 128 * 1024;
const MAX_TOOL_CALLS_BYTES = 128 * 1024;

function decodeBase64Json(value, label, maxBytes) {
  if (value === undefined || value === null || value === "" || value === "null" || value === "-") return null;
  const decoded = Buffer.from(String(value), "base64").toString("utf8");
  if (Buffer.byteLength(decoded) > maxBytes) {
    throw new Error(`${label} exceeds the 128 KiB limit`);
  }
  return JSON.stringify(JSON.parse(decoded));
}

function normalizeHistorySeed(value) {
  if (value === undefined || value === null || value === "" || value === "null") return null;
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray(parsed.messages)) {
    throw new Error("History seed must be an object with a messages array");
  }
  const serialized = JSON.stringify(parsed);
  if (Buffer.byteLength(serialized) > MAX_HISTORY_SEED_BYTES) {
    throw new Error("History seed exceeds the 128 KiB limit");
  }
  return serialized;
}

export async function seedHistory(history, historySeed) {
  if (!history) return false;
  const serialized = normalizeHistorySeed(historySeed);
  if (!serialized) return false;
  await mkdir(dirname(history), { recursive: true });
  try {
    // A retried or later loop iteration must never replace a newer checkpoint.
    await writeFile(history, serialized, { flag: "wx" });
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
}

// Opt-in durable fast path: execute the complete tool batch and resume the
// model in one Lambda/warm-runtime request. The classic run-tool + resume
// commands remain unchanged for packages whose tools need separate suspension.
export async function runToolsAndResumeExecutor(params, options = {}) {
  const seed = options.seedHistory || seedHistory;
  const runTools = options.runToolCalls || (async toolParams => {
    const { runToolCalls } = await import("./RunToolExecutor.js");
    return runToolCalls(toolParams);
  });
  const resume = options.resumeExecutor || (async resumeParams => {
    const { resumeExecutor } = await import("./PlanExecutor.js");
    return resumeExecutor(resumeParams);
  });

  const historySeed = decodeBase64Json(
    params.historySeedBase64,
    "History seed",
    MAX_HISTORY_SEED_BYTES
  ) || params.historySeed;
  const toolCalls = decodeBase64Json(
    params.toolCallsBase64,
    "Tool calls",
    MAX_TOOL_CALLS_BYTES
  ) || params.toolCalls;

  await timed("agent.history-seed", () => seed(params.history, historySeed));
  const toolResults = await runTools({ ...params, toolCalls });
  return resume({ ...params, toolResults });
}
