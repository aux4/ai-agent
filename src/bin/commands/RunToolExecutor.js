import { readFile } from "node:fs/promises";
import { createTools } from "../../lib/Tools.js";

async function parseToolCall(value) {
  if (value && typeof value === "object") return value;
  const raw = String(value || "").trim();
  if (!raw) throw new Error("A tool call is required");
  if (raw.startsWith("{")) return JSON.parse(raw);
  return JSON.parse(await readFile(raw, "utf8"));
}

function stringifyContent(value) {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return JSON.stringify(value);
}

// Execute one tool call through the SAME registry used by ask/plan. This keeps
// permissions, argument validation, command discovery, and tool behavior in one
// implementation instead of rebuilding a second cloud-only registry.
export async function runToolExecutor(params) {
  const call = await parseToolCall(params.toolCall);
  if (!call.id || !call.name) throw new Error("Tool call must contain \"id\" and \"name\"");

  const tools = createTools({
    storage: params.storage || ".context",
    embeddingsConfig: params.embeddings || {},
    permissions: params.permissions || {},
    references: params.references || "",
    skills: params.skills || ".agents/skills",
    tools: String(params.tools || "").split(",").map(name => name.trim()).filter(Boolean)
  });
  const selected = tools[call.name];
  let content;
  try {
    content = selected
      ? await selected.invoke(call.arguments || {})
      : `Error: tool "${call.name}" is not available.`;
  } catch (error) {
    // A tool failure is an observation for the next planning turn, not a reason
    // to tear down the durable workflow. The model can explain, retry, or choose
    // a different tool from this normal result envelope.
    content = `Error: ${error?.message || String(error)}`;
  }

  console.log(JSON.stringify({ id: call.id, content: stringifyContent(content) }));
}
