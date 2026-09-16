import { readFile } from "node:fs/promises";
import { createTools } from "../../lib/Tools.js";
import { timed } from "../../lib/Timing.js";
import { isWarmRuntimeRequest } from "../../lib/RuntimeContext.js";

export async function parseToolCall(value) {
  if (value && typeof value === "object") return value;
  const raw = String(value || "").trim();
  if (!raw) throw new Error("A tool call is required");
  if (raw.startsWith("{")) return JSON.parse(raw);
  return JSON.parse(await readFile(raw, "utf8"));
}

export async function parseToolCalls(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return [value];
  const raw = String(value || "").trim();
  if (!raw) throw new Error("At least one tool call is required");
  const parsed = raw.startsWith("[") || raw.startsWith("{")
    ? JSON.parse(raw)
    : JSON.parse(await readFile(raw, "utf8"));
  return Array.isArray(parsed) ? parsed : [parsed];
}

function stringifyContent(value) {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return JSON.stringify(value);
}

// Execute one tool call through the SAME registry used by ask/plan. This keeps
// permissions, argument validation, command discovery, and tool behavior in one
// implementation instead of rebuilding a second cloud-only registry.
export async function runToolCalls(params) {
  const calls = await timed("agent.results-load", () => parseToolCalls(params.toolCalls));
  for (const call of calls) {
    if (!call.id || !call.name) throw new Error("Tool call must contain \"id\" and \"name\"");
  }
  const tools = await timed("package.discovery", async () => createTools({
    storage: params.storage || ".context",
    embeddingsConfig: params.embeddings || {},
    permissions: params.permissions || {},
    references: params.references || "",
    skills: params.skills || ".agents/skills",
    tools: String(params.tools || "").split(",").map(name => name.trim()).filter(Boolean)
  }), { cacheHit: isWarmRuntimeRequest() });
  return Promise.all(calls.map(async call => {
    const selected = tools[call.name];
    let content;
    try {
      content = selected
        ? await timed("command.execution", () => selected.invoke(call.arguments || {}))
        : `Error: tool "${call.name}" is not available.`;
    } catch (error) {
      // A tool failure is an observation for the next planning turn, not a reason
      // to tear down the durable workflow. The model can explain, retry, or choose
      // a different tool from this normal result envelope.
      content = `Error: ${error?.message || String(error)}`;
    }
    // Carry the tool name alongside id/content so Prompt.injectToolResults can
    // populate the tool-result `name` via its `tr.name` fallback even if the
    // history round-trip ever fails to pair it. Correctness must not depend
    // solely on reconstructing the name from durable history.
    return { id: call.id, name: call.name, content: stringifyContent(content) };
  }));
}

export async function runToolExecutor(params) {
  const [result] = await runToolCalls({ ...params, toolCalls: params.toolCall });
  console.log(JSON.stringify(result));
}
