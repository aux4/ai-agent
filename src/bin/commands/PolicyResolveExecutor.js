import { resolveEscalation } from "../../lib/Escalation.js";

// Resolve a parked (block-mode) escalation. A human — or an automated approver
// agent — calls this with the escalation id and a decision:
//   allow_once  -> the blocked action proceeds this once
//   widen       -> proceed (operator has widened the policy out-of-band)
//   stop        -> the run stays denied
export async function policyResolveExecutor(params) {
  const { id, decision } = params;

  if (!id) {
    console.error("Error: --id is required");
    process.exit(1);
  }
  if (!decision) {
    console.error("Error: --decision is required (allow_once|widen|stop)");
    process.exit(1);
  }

  try {
    const result = resolveEscalation(id, decision);
    console.log(JSON.stringify({ escalationId: result.escalationId, state: result.state, decision: result.decision }));
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}
