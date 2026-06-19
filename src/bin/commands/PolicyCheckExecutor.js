import { Policy } from "../../lib/Policy.js";

// Deterministic policy decision check — does NOT run any tool or LLM. Operators and
// tests use it to verify what a policy would decide for a given tool/action and spend
// snapshot. Escalation rules are NOT fired here (this is a dry check).
export async function policyCheckExecutor(params) {
  const { tool, action = "", policy: policySpec, usage = {}, calls = 0 } = params;

  if (!tool) {
    console.error("Error: --tool is required");
    process.exit(1);
  }

  let spec = policySpec;
  if (typeof policySpec === "string" && policySpec.includes(",")) {
    spec = policySpec.split(",").map(s => s.trim()).filter(Boolean);
  }

  const policy = Policy.load(spec, {});

  // Build args matching the tool's subject extraction.
  const args = {};
  if (tool === "executeAux4") args.command = action;
  else if (tool === "removeFiles") args.files = action;
  else { args.file = action; args.path = action; }

  const normalizedUsage = typeof usage === "object" ? usage : {};
  const callCount = parseInt(calls) || 0;
  const outcome = policy.decide(tool, args, normalizedUsage, callCount);

  const out = {
    tool,
    action,
    decision: outcome.decision,
    reason: outcome.reason
  };
  if (outcome.trigger) out.trigger = outcome.trigger;
  out.spend = outcome.spend;

  console.log(JSON.stringify(out));
}
