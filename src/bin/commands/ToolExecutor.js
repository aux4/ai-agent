import { createTools } from "../../lib/Tools.js";
import { Policy } from "../../lib/Policy.js";

const names = {
  "read-file": "readFile", "write-file": "writeFile", "edit-file": "editFile",
  "save-image": "saveImage", "list-files": "listFiles", "search-files": "searchFiles",
  "create-directory": "createDirectory", "remove-files": "removeFiles",
  "search-context": "searchContext", "ask-user": "askUser",
  "current-date-time": "currentDateTime", "read-reference": "readReference",
  "read-skill": "readSkill", "search-text": "searchText", "aux4-skill": "aux4Skill"
};

export async function toolExecutor({ name, input = "{}" }) {
  const toolName = names[name];
  if (!toolName) throw new Error(`Unknown agent tool command: ${name}`);
  let args;
  try { args = JSON.parse(input || "{}"); }
  catch { throw new Error("Tool input must be a JSON object"); }
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Tool input must be a JSON object");

  let context = {};
  try { context = JSON.parse(process.env.AUX4_AI_AGENT_TOOL_CONTEXT || "{}"); } catch {}
  const usage = context.toolUsage || {};
  const policy = context.policySpec
    ? Policy.load(context.policySpec, { staticPermissions: context.permissions, runId: context.runId, costs: context.costs })
    : null;
  const tools = createTools({
    permissions: context.permissions, storage: context.storage, references: context.references,
    skills: context.skills, policy, getUsage: () => usage, tools: [toolName]
  });
  const result = await tools[toolName].invoke(args);
  if (typeof result === "string") process.stdout.write(result);
  else process.stdout.write(JSON.stringify(result));
}
