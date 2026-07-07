// Loop budget for the agent tool-execution loop.
//
// The agent loop (Prompt.execute / CodexApi.execute) keeps invoking the model and
// running the tools it requests until the model stops asking for tools. A
// misbehaving model can loop forever, burning tokens and wall-clock time. The
// LoopBudget caps that loop:
//
//   - maxIterations: hard cap on the number of tool-execution rounds (always on;
//     default 50). This is the primary safety valve for autonomous agents.
//   - maxTokens: optional cap on total tokens consumed during the ask.
//   - maxTimeMs: optional cap on wall-clock time spent in the loop.
//
// When any limit is reached the loop terminates cleanly: it does NOT throw away the
// conversation. The caller appends a final assistant-visible note (prefixed with
// BUDGET_EXCEEDED_MARKER), persists the history, and surfaces a non-zero exit so a
// supervisor can detect the truncation.

export const BUDGET_EXCEEDED_MARKER = "[budget-exceeded]";

// Exit code used by the ask command when a loop budget is tripped. Distinct from a
// generic failure (1) so a supervising process can tell "budget truncation" apart
// from a real error.
export const BUDGET_EXIT_CODE = 7;

function toPositiveInt(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export class LoopBudget {
  constructor(config = {}) {
    // Iteration cap is always active. An invalid / missing value falls back to the
    // default so the loop can never be uncapped by accident.
    this.maxIterations = toPositiveInt(config.maxIterations) || 50;
    // Token and time caps are opt-in: null means "no limit".
    this.maxTokens = toPositiveInt(config.maxTokens);
    this.maxTimeMs = toPositiveInt(config.maxTimeMs);

    this.iterations = 0;
    this.consumed = 0;
    this.startTime = Date.now();
  }

  // Reset counters for a fresh ask (a reused Prompt instance).
  reset() {
    this.iterations = 0;
    this.consumed = 0;
    this.startTime = Date.now();
  }

  // Record tokens consumed by a model response. Callers own their token accounting
  // and feed the per-response delta here.
  addConsumed(tokens) {
    const n = typeof tokens === "number" ? tokens : parseInt(tokens, 10);
    if (Number.isFinite(n) && n > 0) {
      this.consumed += n;
    }
  }

  elapsed() {
    return Date.now() - this.startTime;
  }

  // Record one tool-execution round about to run and return the reason string if a
  // limit is now exceeded (else null). Call this BEFORE running the round's tools so
  // the round can be skipped when the budget is spent.
  recordIteration() {
    this.iterations += 1;
    return this.overBudget();
  }

  // Return a human-readable reason if any limit is exceeded, else null.
  overBudget() {
    if (this.iterations > this.maxIterations) {
      return `maximum tool-loop iterations reached (limit ${this.maxIterations})`;
    }
    if (this.maxTokens !== null && this.consumed >= this.maxTokens) {
      return `token budget reached (${this.consumed} >= ${this.maxTokens} tokens)`;
    }
    if (this.maxTimeMs !== null && this.elapsed() >= this.maxTimeMs) {
      return `time budget reached (${this.elapsed()}ms >= ${this.maxTimeMs}ms)`;
    }
    return null;
  }

  // Build the final assistant-visible note appended to the conversation when the
  // budget trips. Includes the tools the model was about to call and any partial
  // text it had already produced, so a human or supervisor sees what was in progress.
  terminationNote(reason, { pendingTools = "", partial = "" } = {}) {
    let note = `${BUDGET_EXCEEDED_MARKER} Loop budget exceeded: ${reason}. `
      + "The task was stopped before completion to prevent a runaway tool loop.";
    if (pendingTools) {
      note += ` The agent was about to call: ${pendingTools}.`;
    }
    if (partial && partial.trim() !== "") {
      note += `\n\nWork in progress:\n${partial.trim()}`;
    }
    return note;
  }
}

export default LoopBudget;
