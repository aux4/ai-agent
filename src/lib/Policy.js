import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import yaml from "js-yaml";
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

// Where the approved hash pin for a referenced policy file lives. The pin file sits
// next to the policy file as "<policy>.sha256" and contains the approved sha256 hex.
// Operators write it once when they approve a policy; a self-improving agent cannot
// (its write scope excludes the policy file's directory). A mismatch fails closed.
function pinPathFor(policyFile) {
  return `${policyFile}.sha256`;
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function expandTilde(p) {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
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

// Narrowing merge of two policy layers. The base is the more-trusted layer; the
// incoming layer may only tighten. deny = union, allow = intersection,
// budget = min. Returns the resolved (narrower) policy.
export function narrowMerge(base, incoming) {
  const result = { allow: [], deny: [], budget: {}, escalate: [] };

  const baseDeny = indexRules(base.deny);
  const incDeny = indexRules(incoming.deny);
  result.deny = unionRules(baseDeny, incDeny);

  const baseAllow = indexRules(base.allow);
  const incAllow = indexRules(incoming.allow);
  result.allow = intersectAllow(base.allow, incoming.allow, baseAllow, incAllow);

  result.budget = minBudget(base.budget || {}, incoming.budget || {});

  // escalate rules accumulate (more triggers covered = tighter oversight)
  result.escalate = [...(base.escalate || []), ...(incoming.escalate || [])];

  return result;
}

function unionRules(a, b) {
  const tools = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out = [];
  for (const tool of tools) {
    const patterns = Array.from(new Set([...(a[tool] || []), ...(b[tool] || [])]));
    out.push({ [tool]: patterns });
  }
  return out;
}

// allow intersection: a tool is allowed by the resolved layer only if it appears in
// BOTH layers' allow lists (when both constrain it). If only one layer constrains a
// tool, that constraint applies (the other layer placed no allow-restriction on it).
function intersectAllow(baseList, incList, baseMap, incMap) {
  // No allow constraints anywhere -> no allow narrowing.
  if ((!baseList || baseList.length === 0) && (!incList || incList.length === 0)) return [];
  const tools = new Set([...Object.keys(baseMap), ...Object.keys(incMap)]);
  const out = [];
  for (const tool of tools) {
    const inBase = baseMap[tool];
    const inInc = incMap[tool];
    if (inBase && inInc) {
      // both constrain -> intersection of patterns
      const set = new Set(inBase);
      const patterns = inInc.filter(p => set.has(p));
      out.push({ [tool]: patterns });
    } else if (inBase) {
      out.push({ [tool]: inBase });
    } else if (inInc) {
      out.push({ [tool]: inInc });
    }
  }
  return out;
}

function minBudget(a, b) {
  const out = {};
  for (const key of ["tokens", "usd", "calls"]) {
    const va = a[key];
    const vb = b[key];
    if (va != null && vb != null) out[key] = Math.min(va, vb);
    else if (va != null) out[key] = va;
    else if (vb != null) out[key] = vb;
  }
  return out;
}

// Verify the resolved policy is not looser than the base on security keys.
// Returns null if ok, or a reason string if it is looser (fail closed).
export function checkNotLooser(base, resolved) {
  // budget: resolved must be <= base for each declared cap
  for (const key of ["tokens", "usd", "calls"]) {
    const b = base.budget && base.budget[key];
    const r = resolved.budget && resolved.budget[key];
    if (b != null && (r == null || r > b)) {
      return `resolved budget.${key} (${r}) is looser than base (${b})`;
    }
  }
  // deny: every base deny pattern must still be present in resolved deny
  const baseDeny = indexRules(base.deny);
  const resDeny = indexRules(resolved.deny);
  for (const [tool, patterns] of Object.entries(baseDeny)) {
    const resPatterns = new Set(resDeny[tool] || []);
    for (const p of patterns) {
      if (!resPatterns.has(p)) return `resolved deny dropped "${tool}: ${p}" present in base`;
    }
  }
  return null;
}

export class PolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "PolicyError";
  }
}

export class Policy {
  // spec: string (path) | object (inline) | array of (string|object) layers.
  // options: { staticPermissions, costs: {costIn, costOut, costCache}, agent, runId }
  constructor(resolved, options = {}) {
    this.allow = indexRules(resolved.allow);
    this.deny = indexRules(resolved.deny);
    this.budget = resolved.budget || {};
    this.escalate = resolved.escalate || [];
    this.failClosedReason = resolved._failClosedReason || null;
    this.staticPermissions = options.staticPermissions || null;
    this.costs = options.costs || {};
    this.agent = options.agent || "agent";
    this.runId = options.runId || "";
    this.policyRef = options.policyRef || "";
    this.escalationOptions = options.escalationOptions || {};
    this.decisions = [];
  }

  // Build a Policy from a spec. Throws PolicyError on hash mismatch / load errors,
  // OR (when failClosed) returns a Policy whose every decision is deny.
  static load(spec, options = {}) {
    const layers = Array.isArray(spec) ? spec : [spec];
    let resolved = { allow: [], deny: [], budget: {}, escalate: [] };
    let policyRef = "";

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      let parsed;

      if (typeof layer === "string") {
        const file = path.resolve(expandTilde(layer));
        policyRef = policyRef || layer;
        if (!fs.existsSync(file)) {
          return Policy._failClosed(`policy file not found: ${layer}`, options, policyRef);
        }
        const content = fs.readFileSync(file, "utf-8");
        const pinFile = pinPathFor(file);
        if (!fs.existsSync(pinFile)) {
          return Policy._failClosed(`no approved hash pin for policy "${layer}" (expected ${path.basename(pinFile)})`, options, policyRef);
        }
        const approved = fs.readFileSync(pinFile, "utf-8").trim().split(/\s+/)[0];
        const actual = sha256(content);
        if (approved !== actual) {
          return Policy._failClosed(`policy hash mismatch for "${layer}" (approved ${approved.slice(0, 12)}…, got ${actual.slice(0, 12)}…)`, options, policyRef);
        }
        parsed = extractPolicy(parseContent(content, file));
      } else if (layer && typeof layer === "object") {
        parsed = extractPolicy(layer);
      } else {
        continue;
      }

      const layerPolicy = {
        allow: parsed.allow || [],
        deny: parsed.deny || [],
        budget: parsed.budget || {},
        escalate: parsed.escalate || []
      };

      if (i === 0) {
        resolved = layerPolicy;
      } else {
        const merged = narrowMerge(resolved, layerPolicy);
        const looser = checkNotLooser(resolved, merged);
        if (looser) {
          return Policy._failClosed(`policy layer ${i} would loosen guardrails: ${looser}`, options, policyRef);
        }
        resolved = merged;
      }
    }

    return new Policy(resolved, { ...options, policyRef });
  }

  static _failClosed(reason, options, policyRef) {
    const resolved = { allow: [], deny: [], budget: {}, escalate: [], _failClosedReason: reason };
    return new Policy(resolved, { ...options, policyRef });
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

    // Fail closed: a referenced policy that did not verify denies everything.
    if (this.failClosedReason) {
      return { decision: "deny", reason: this.failClosedReason, trigger: "hash_mismatch", action, spend };
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

    // Policy deny (union of all layers) — narrows below static permissions.
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
          policy: this.policyRef,
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

function parseContent(content, file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".json") {
    return JSON.parse(content);
  }
  // YAML (covers .yaml/.yml and any other extension)
  return yaml.load(content);
}

export default Policy;
