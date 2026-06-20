import { Policy } from "../../lib/Policy.js";

// Policy decision check for a given tool/action and spend snapshot. Does NOT call an
// LLM. When the policy has an escalate rule matching the resulting trigger, the
// escalation is fired (notify) and the parked/notified outcome is reflected — this is
// how operators and tests exercise the escalation path (including ${runId} injection)
// deterministically. When no runId is supplied, the policy auto-generates one.
export async function policyCheckExecutor(params) {
  const { tool, action = "", policy: policySpec, usage = {}, calls = 0, runId = "", costs = {} } = params;

  if (!tool) {
    console.error("Error: --tool is required");
    process.exit(1);
  }

  const policy = Policy.load(policySpec || {}, {
    runId: runId || undefined,
    costs: typeof costs === "object" ? costs : {}
  });

  // Build args matching the tool's subject extraction.
  const args = {};
  if (tool === "executeAux4") args.command = action;
  else if (tool === "removeFiles") args.files = action;
  else { args.file = action; args.path = action; }

  const normalizedUsage = typeof usage === "object" ? usage : {};
  const callCount = parseInt(calls) || 0;

  // enforce() runs the decision and fires any matching escalation rule, so ${runId}
  // and the escalation command are exercised. It records the decision and returns the
  // blocked/allow outcome.
  const result = await policy.enforce(tool, args, normalizedUsage, callCount, null);
  const decision = result.decision;

  const out = {
    tool,
    action,
    decision: decision.decision,
    reason: decision.reason
  };
  if (decision.trigger) out.trigger = decision.trigger;
  if (decision.escalationId) out.escalationId = decision.escalationId;
  out.runId = policy.runId;

  console.log(JSON.stringify(out));
}
