import { URL } from "node:url";

const TRACE_ID = /^[a-zA-Z0-9_-]{8,64}$/;
const LABEL = /^[a-z][a-z0-9.-]{0,63}$/;

export function getTraceId() {
  const traceId = process.env.AUX4_TRACE_ID || "";
  return TRACE_ID.test(traceId) ? traceId : "";
}

function phase() {
  const value = String(process.env.AUX4_EXECUTION_PHASE || "agent").toLowerCase();
  return LABEL.test(value) ? value : "agent";
}

export function startTiming(span) {
  const traceId = getTraceId();
  const started = process.hrtime.bigint();
  let ended = false;

  return (status = "ok", attributes = {}) => {
    if (!traceId || ended || !LABEL.test(span)) return;
    ended = true;
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    const record = {
      type: "aux4.timing",
      traceId,
      phase: phase(),
      span,
      durationMs: Number(durationMs.toFixed(3)),
      status: status === "error" ? "error" : "ok"
    };
    if (typeof attributes.cacheHit === "boolean") record.cacheHit = attributes.cacheHit;
    if (typeof attributes.cold === "boolean") record.cold = attributes.cold;
    process.stderr.write(`${JSON.stringify(record)}\n`);
  };
}

export async function timed(span, operation, attributes = {}) {
  const end = startTiming(span);
  try {
    const result = await operation();
    end("ok", attributes);
    return result;
  } catch (error) {
    end("error", attributes);
    throw error;
  }
}

export function internalTraceHeaders(baseURL) {
  const traceId = getTraceId();
  if (!traceId || typeof baseURL !== "string") return {};
  try {
    const hostname = new URL(baseURL).hostname;
    if (hostname !== "localhost" && hostname !== "127.0.0.1" && !hostname.endsWith(".aux4.cloud")) {
      return {};
    }
    return { "x-aux4-trace-id": traceId };
  } catch {
    return {};
  }
}

// Child aux4 packages may emit timing records on stderr. Re-emit only a small,
// normalized schema for this trace; ordinary stderr retains its old behavior.
export function extractChildTimings(stderr = "") {
  const traceId = getTraceId();
  const remaining = [];
  for (const line of String(stderr).split("\n")) {
    let record;
    try { record = JSON.parse(line); } catch {}
    const valid = traceId
      && record?.type === "aux4.timing"
      && record.traceId === traceId
      && LABEL.test(record.phase || "")
      && LABEL.test(record.span || "")
      && Number.isFinite(record.durationMs)
      && record.durationMs >= 0
      && record.durationMs <= 900000
      && ["ok", "error"].includes(record.status);
    if (!valid) {
      if (line) remaining.push(line);
      continue;
    }
    const normalized = {
      type: "aux4.timing",
      traceId,
      phase: record.phase,
      span: record.span,
      durationMs: record.durationMs,
      status: record.status
    };
    if (typeof record.cacheHit === "boolean") normalized.cacheHit = record.cacheHit;
    if (typeof record.cold === "boolean") normalized.cold = record.cold;
    process.stderr.write(`${JSON.stringify(normalized)}\n`);
  }
  return remaining.join("\n");
}
