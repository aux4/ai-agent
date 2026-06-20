import { parsePattern, matchesPattern } from "./PatternUtils.js";
import { runEscalation } from "./Escalation.js";

// Consequential tools — these go through the policy enforcement hook.
// Read-only tools (readFile, listFiles, searchFiles, searchContext, currentDateTime,
// readReference, readSkill, askUser) are exempt for speed and because they cannot
// mutate state or spend an unbounded budget.
export const CONSEQUENTIAL_TOOLS = new Set([
  "executeAux4",
  "writeFile",
  "editFile",
  "removeFiles",
  "createDirectory",
  "saveImage"
]);

// Generate a stable, meaningful run id when the caller does not supply one. Used so
// ${runId} in escalation commands and the history run reference is always populated.
// Shape: run_<base36 timestamp>_<short random suffix>.
export function generateRunId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `run_${ts}_${rand}`;
}

// Extract the policy-relevant keys from a parsed object. Accepts either a bare
// policy object ({budget, allow, deny, escalate}) or a config-style wrapper
// ({config: {...}} / {policy: {...}}).
function extractPolicy(obj) {
  if (!obj || typeof obj !== "object") return {};
  if (obj.policy && typeof obj.policy === "object") return obj.policy;
  if (obj.config && typeof obj.config === "object" && (obj.config.allow || obj.config.deny || obj.config.budget || obj.config.escalate)) {
    return obj.config;
  }
  return obj;
}

// Convert an allow/deny list ([{tool:[patterns]}, ...]) into a map tool -> [patterns].
function indexRules(list) {
  const map = {};
  for (const entry of list || []) {
    if (!entry || typeof entry !== "object") continue;
    for (const [tool, patterns] of Object.entries(entry)) {
      const arr = Array.isArray(patterns) ? patterns : [patterns];
      map[tool] = (map[tool] || []).concat(arr);
    }
  }
  return map;
}

export class PolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "PolicyError";
  }
}

export class Policy {
  // resolved: { allow, deny, budget, escalate }
  // options: { staticPermissions, costs: {costIn, costOut, costCache}, agent, runId }
  constructor(resolved, options = {}) {
    this.allow = indexRules(resolved.allow);
    this.deny = indexRules(resolved.deny);
    this.budget = resolved.budget || {};
    this.escalate = resolved.escalate || [];
    this.staticPermissions = options.staticPermissions || null;
    this.costs = options.costs || {};
    this.agent = options.agent || "agent";
    // Auto-generate a run id when none is provided so ${runId} is always meaningful.
    this.runId = options.runId || generateRunId();
    this.escalationOptions = options.escalationOptions || {};
    this.decisions = [];
  }

  // Build a Policy from an inline policy object. aux4 delivers a config.yaml object
  // param as a JSON string for free, so callers JSON.parse before reaching here.
  // Accepts a bare policy object or a {config:{...}}/{policy:{...}} wrapper.
  static load(spec, options = {}) {
    const parsed = extractPolicy(spec && typeof spec === "object" ? spec : {});
    const resolved = {
      allow: parsed.allow || [],
      deny: parsed.deny || [],
      budget: parsed.budget || {},
      escalate: parsed.escalate || []
    };
    return new Policy(resolved, options);
  }

  // Compute the subject string that allow/deny patterns match against for a tool.
  subjectFor(toolName, args = {}) {
    if (toolName === "executeAux4") return args.command || "";
    if (toolName === "removeFiles") {
      const f = Array.isArray(args.files) ? args.files[0] : args.files;
      return f || "";
    }
    return args.file || args.path || args.imageName || "";
  }

  matchAny(patterns, subject) {
    for (const raw of patterns || []) {
      // executeAux4 patterns are command globs; file tools use plain path globs.
      const parsed = raw.includes(":") ? parsePattern(raw) : { pattern: raw };
      if (matchesPattern(subject, parsed.pattern || raw)) return true;
    }
    return false;
  }

  // Compute the current spend snapshot for budget checks.
  spend(usage = {}, calls = 0) {
    const tokens = usage.total || 0;
    const { costIn = 0, costOut = 0, costCache = 0 } = this.costs;
    const usd =
      ((usage.input || 0) * costIn +
        (usage.output || 0) * costOut +
        (usage.cached || 0) * costCache) /
      1_000_000;
    return { tokens, usd, calls };
  }

  // Returns the budget trigger name if any cap is exceeded, else null.
  budgetTrigger(spend) {
    if (this.budget.tokens != null && spend.tokens > this.budget.tokens) return "budget_exceeded";
    if (this.budget.calls != null && spend.calls > this.budget.calls) return "budget_exceeded";
    if (this.budget.usd != null && spend.usd > this.budget.usd) return "budget_exceeded";
    return null;
  }

  // Core decision for a consequential tool call.
  // usage = live tokenUsage; calls = tool call count INCLUDING this one.
  // Returns { decision: "allow"|"deny", reason, trigger?, action }.
  decide(toolName, args = {}, usage = {}, calls = 0) {
    const action = `${toolName}(${this.subjectFor(toolName, args)})`;
    const spend = this.spend(usage, calls);

    // Read-only tools are exempt.
    if (!CONSEQUENTIAL_TOOLS.has(toolName)) {
      return { decision: "allow", reason: "read-only tool (exempt)", action, spend };
    }

    const subject = this.subjectFor(toolName, args);

    // Budget first.
    const bt = this.budgetTrigger(spend);
    if (bt) {
      const cap = this.budget.tokens != null && spend.tokens > this.budget.tokens
        ? `${this.budget.tokens} tokens`
        : this.budget.calls != null && spend.calls > this.budget.calls
          ? `${this.budget.calls} calls`
          : `$${this.budget.usd}`;
      return {
        decision: "deny",
        reason: `budget exceeded (spent ${spend.tokens} tokens / ${spend.calls} calls / $${spend.usd.toFixed(4)}, cap ${cap})`,
        trigger: bt,
        action,
        spend,
        cap
      };
    }

    // Policy deny — narrows below static permissions.
    if (this.deny[toolName] && this.matchAny(this.deny[toolName], subject)) {
      return {
        decision: "deny",
        reason: `policy denies ${toolName} "${subject}"`,
        trigger: "denied_action",
        action,
        spend
      };
    }

    // Policy allow — if this tool is constrained by an allow list, the subject must
    // match one of its patterns; otherwise deny (allow narrows).
    if (this.allow[toolName] && this.allow[toolName].length > 0) {
      if (!this.matchAny(this.allow[toolName], subject)) {
        return {
          decision: "deny",
          reason: `${toolName} "${subject}" is outside the policy allow-list`,
          trigger: "denied_action",
          action,
          spend
        };
      }
    }

    return { decision: "allow", reason: "permitted by policy", action, spend };
  }

  // Find the escalate rule matching a trigger, if any.
  escalateFor(trigger) {
    return (this.escalate || []).find(rule => (rule.on || []).includes(trigger)) || null;
  }

  // Enforce a consequential tool call. Runs the decision, applies any matching
  // escalation, records the outcome (so Prompt can attach it to history via
  // takeDecision), and returns { blocked, message, decision }.
  // decision is the recorded shape: { decision, reason, trigger?, action }.
  async enforce(toolName, args, usage, calls, callId) {
    let outcome = this.decide(toolName, args, usage, calls);

    // If denied/over-budget and an escalate rule covers the trigger, run it.
    if (outcome.decision === "deny" && outcome.trigger) {
      const rule = this.escalateFor(outcome.trigger);
      if (rule) {
        const escalation = await runEscalation(rule, {
          trigger: outcome.trigger,
          reason: outcome.reason,
          agent: this.agent,
          runId: this.runId,
          action: outcome.action,
          spent: outcome.spend ? outcome.spend.tokens : 0,
          cap: outcome.cap
        }, this.escalationOptions || {});

        outcome = {
          ...outcome,
          decision: escalation.decision === "allow" ? "allow" : "escalate",
          reason: escalation.reason,
          escalationId: escalation.escalationId
        };
      }
    }

    const record = {
      decision: outcome.decision,
      reason: outcome.reason,
      trigger: outcome.trigger,
      action: outcome.action
    };
    if (outcome.escalationId) record.escalationId = outcome.escalationId;
    this.recordDecision(callId, record);

    if (outcome.decision === "allow") {
      return { blocked: false, decision: record };
    }
    // escalate (block, resolved stop) and deny both block the tool from running.
    return {
      blocked: true,
      decision: record,
      message: `⛔ policy ${outcome.trigger || "denied"}: ${outcome.reason}. Choose another approach.`
    };
  }

  recordDecision(callId, record) {
    this.decisions.push(record);
    if (callId) {
      this._byCallId = this._byCallId || {};
      this._byCallId[callId] = record;
    }
  }

  // Pop the decision recorded for a given tool_call_id (used by Prompt to annotate
  // the history tool entry). Returns the record or null.
  takeDecision(callId) {
    if (!callId || !this._byCallId) return null;
    const rec = this._byCallId[callId];
    delete this._byCallId[callId];
    return rec || null;
  }
}

export default Policy;
