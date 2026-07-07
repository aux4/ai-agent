// Structured JSON event stream for the agent runtime.
//
// A supervising process (agent/agent, the Conductor, an eval/trace consumer) needs
// to observe a run PROGRAMMATICALLY rather than scraping human-readable stderr text.
// This module emits one JSON object per line (JSONL) to a configurable sink.
//
// Contract:
//   - Every event is a single line: JSON.stringify(event) + "\n".
//   - Every event carries: ts (ms epoch), seq (monotonic per run, from 0), run
//     (run/session id), type (event name), plus type-specific payload fields.
//   - The stream is DEFAULT OFF. When disabled, emit() is a cheap no-op — no sink is
//     opened and nothing is written, so there is zero behaviour change.
//   - Enabled via a sink target (the --events flag / config key). A file path opens
//     that file in append mode; "-", "stderr" and "/dev/stderr" write to stderr.
//   - Events go to their OWN sink. They never touch the normal stdout answer, and
//     even on stderr they are self-contained JSON lines that do not disturb the
//     existing AUX4_PENDING_QUESTION marker line.
//   - Observability must never crash a run: a write failure is swallowed.

import fs from "node:fs";
import crypto from "node:crypto";

// Generate a short, unique run/session id used to correlate every event of one run.
export function newRunId() {
  return "run_" + crypto.randomBytes(6).toString("hex");
}

export class EventStream {
  // sink:
  //   null / undefined  -> disabled (no-op)
  //   "stderr"          -> process.stderr
  //   { write }         -> any writable-ish object
  //   string (path)     -> file opened in append mode (JSONL)
  constructor(sink, options = {}) {
    this.seq = 0;
    this.runId = options.runId || newRunId();
    this._fd = null;
    this._writeFn = null;
    this.enabled = false;

    if (sink === null || sink === undefined) return;

    if (sink === "stderr") {
      this._writeFn = line => process.stderr.write(line);
    } else if (typeof sink === "object" && typeof sink.write === "function") {
      this._writeFn = line => sink.write(line);
    } else if (typeof sink === "string" && sink !== "") {
      // File sink. Opened once (append) and written synchronously so events are
      // ordered and flushed even on an abrupt exit; the fd is small and short-lived.
      this._fd = fs.openSync(sink, "a");
      this._writeFn = line => fs.writeSync(this._fd, line);
    } else {
      return;
    }

    this.enabled = true;
  }

  // Emit one event. No-op (and allocates nothing) when disabled.
  emit(type, payload = {}) {
    if (!this.enabled) return;
    const event = { ts: Date.now(), seq: this.seq++, run: this.runId, type, ...payload };
    try {
      this._writeFn(JSON.stringify(event) + "\n");
    } catch {
      // Never let the event stream take down the run.
    }
  }

  close() {
    if (this._fd !== null) {
      try {
        fs.closeSync(this._fd);
      } catch {
        // ignore
      }
      this._fd = null;
    }
    this.enabled = false;
    this._writeFn = null;
  }
}

// Resolve the --events flag / config value to an EventStream. An empty value returns
// a disabled stream (default OFF). "-", "stderr" and "/dev/stderr" go to stderr; any
// other non-empty value is treated as a JSONL file path.
export function createEventStream(target, options = {}) {
  if (target === undefined || target === null) return new EventStream(null, options);
  const value = `${target}`.trim();
  if (value === "") return new EventStream(null, options);
  if (value === "-" || value === "stderr" || value === "/dev/stderr") {
    return new EventStream("stderr", options);
  }
  return new EventStream(value, options);
}

export default EventStream;
