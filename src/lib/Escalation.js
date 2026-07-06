import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { setTimeout as setTimer } from "node:timers";
import { spawnSync } from "node:child_process";
import { tokenizeCommand, expandTildeToken } from "./CommandParser.js";

// Escalations live in a per-user directory so a separate `resolve` invocation
// (possibly an automated approver agent) can answer a parked run.
export function escalationsDir() {
  const dir = path.join(os.homedir(), ".aux4.config", "ai-agent", "escalations");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function parkFile(id) {
  return path.join(escalationsDir(), `${id}.json`);
}

export function newEscalationId() {
  return "esc_" + crypto.randomBytes(6).toString("hex");
}

// Build the variable map injected into the escalate command.
function buildVars(ctx) {
  const json = JSON.stringify({
    trigger: ctx.trigger,
    reason: ctx.reason,
    agent: ctx.agent,
    policy: ctx.policy,
    runId: ctx.runId,
    action: ctx.action,
    spent: ctx.spent,
    cap: ctx.cap,
    escalationId: ctx.escalationId
  });
  return {
    trigger: ctx.trigger || "",
    reason: ctx.reason || "",
    agent: ctx.agent || "",
    policy: ctx.policy || "",
    runId: ctx.runId || "",
    action: ctx.action || "",
    spent: ctx.spent != null ? String(ctx.spent) : "",
    cap: ctx.cap != null ? String(ctx.cap) : "",
    escalationId: ctx.escalationId || "",
    json
  };
}

// Replace ${var} occurrences in a command string with the injected values.
// Pure string utility, kept for callers that need a rendered display string.
// NOTE: this is NOT how the escalate command is executed — execution goes
// through buildEscalationArgv so injected values never reach a shell. See below.
export function injectVars(command, ctx) {
  const vars = buildVars(ctx);
  return command.replace(/\$\{(\w+)\}/g, (m, name) => (name in vars ? vars[name] : m));
}

// Build the argv for `aux4 <escalate command>` with the context values injected,
// WITHOUT going through a shell. The configured command TEMPLATE is tokenized
// first (POSIX quoting/word-splitting only, no substitution), then ${var}
// placeholders are substituted INTO each argv token. Because substitution
// happens AFTER tokenization, an injected value that contains spaces, quotes,
// newlines, backticks, $(), ;, && or | lands as a single literal argv element
// and is never word-split, re-quoted, or shell-interpreted. This is the same
// argv/no-shell treatment CommandParser gives executeAux4 (AGC-016). Tilde
// expansion applies only to unquoted TEMPLATE tokens, never to injected values.
// Throws on malformed quoting in the template.
export function buildEscalationArgv(command, ctx) {
  const vars = buildVars(ctx);
  const substitute = value => value.replace(/\$\{(\w+)\}/g, (m, name) => (name in vars ? vars[name] : m));
  const tokens = tokenizeCommand(command);
  return ["aux4", ...tokens.map(token => substitute(expandTildeToken(token)))];
}

// Fire the escalate command (any aux4 command) directly, with no shell.
// Returns { ok, output }.
function fireCommand(command, ctx) {
  let argv;
  try {
    argv = buildEscalationArgv(command, ctx);
  } catch (e) {
    // Malformed quoting in the configured template: report, never execute.
    return { ok: false, output: `escalate command parse error: ${e.message}` };
  }
  try {
    const result = spawnSync(argv[0], argv.slice(1), { encoding: "utf-8", timeout: 30000 });
    if (result.error) {
      // e.g. the `aux4` binary is not on PATH (ENOENT). Report explicitly —
      // there is deliberately no `sh -c` fallback.
      return { ok: false, output: `escalate command could not run: ${result.error.message}` };
    }
    return { ok: result.status === 0, output: (result.stdout || "") + (result.stderr || "") };
  } catch (e) {
    return { ok: false, output: e.message };
  }
}

// Run an escalation. mode "notify" fires and returns immediately; mode "block"
// fires, parks the run, and waits until a `resolve` writes a decision (or the
// timeout elapses). Unanswered block escalations stay parked (fail closed).
// Returns { decision: "deny"|"allow", reason }.
export async function runEscalation(rule, ctx, options = {}) {
  const escalationId = ctx.escalationId || newEscalationId();
  const fullCtx = { ...ctx, escalationId };
  const mode = rule.mode || "notify";

  if (rule.command) {
    const fired = fireCommand(rule.command, fullCtx);
    if (!fired.ok) {
      console.error(`[policy] escalate command failed: ${fired.output}`.slice(0, 500));
    }
  }

  if (mode === "notify") {
    return { decision: "deny", reason: `${ctx.reason} (notified, run continues)`, escalationId };
  }

  // block mode: park the run and wait for a resolve decision.
  const file = parkFile(escalationId);
  fs.writeFileSync(file, JSON.stringify({
    escalationId,
    trigger: ctx.trigger,
    reason: ctx.reason,
    agent: ctx.agent,
    action: ctx.action,
    createdAt: Date.now(),
    state: "parked"
  }, null, 2));

  const waitMs = options.waitMs != null ? options.waitMs : 0; // 0 => fail closed immediately when non-interactive
  const pollMs = options.pollMs || 1000;
  const deadline = Date.now() + waitMs;

  do {
    const resolution = readResolution(escalationId);
    if (resolution && resolution.state === "resolved") {
      cleanup(escalationId);
      if (resolution.decision === "allow_once" || resolution.decision === "widen") {
        return { decision: "allow", reason: `escalation ${escalationId} resolved: ${resolution.decision}`, escalationId };
      }
      return { decision: "deny", reason: `escalation ${escalationId} resolved: stop`, escalationId };
    }
    if (Date.now() >= deadline) break;
    await sleep(pollMs);
  } while (Date.now() < deadline);

  // Unanswered -> stays parked, fail closed.
  return { decision: "deny", reason: `escalation ${escalationId} unanswered (parked, fail closed)`, escalationId };
}

function readResolution(id) {
  const file = parkFile(id);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

function cleanup(id) {
  try { fs.unlinkSync(parkFile(id)); } catch {}
}

// Write a resolution for a parked escalation (used by the `policy resolve` command).
export function resolveEscalation(id, decision) {
  const valid = ["allow_once", "widen", "stop"];
  if (!valid.includes(decision)) {
    throw new Error(`invalid decision "${decision}" (expected ${valid.join("|")})`);
  }
  const file = parkFile(id);
  const existing = readResolution(id) || { escalationId: id };
  const updated = { ...existing, state: "resolved", decision, resolvedAt: Date.now() };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(updated, null, 2));
  return updated;
}

function sleep(ms) {
  return new Promise(resolve => setTimer(resolve, ms));
}

export default { runEscalation, resolveEscalation, injectVars, buildEscalationArgv, newEscalationId, escalationsDir };
