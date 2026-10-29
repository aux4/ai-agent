import { parseCommandArgs } from "./CommandArgs.js";

// When the repeated result is aux4's own parameter error, it already names the fix; a small
// model that re-reads only "do not repeat" tends to wander off instead of changing the flag.
export function repeatFixHint(result, command = "") {
  const text = String(result || "");
  // "Command not found ... Did you mean: aux4 agent browser find": spell out the corrected
  // call with the agent's own arguments, ready to run.
  const meant = text.match(/Command not found[\s\S]*?Did you mean:\s*(?:aux4\s+)?([^\n]+?)\s*$/m);
  if (meant) {
    const suggestion = meant[1].trim();
    const fixed = correctedCommand(String(command || ""), suggestion);
    return fixed
      ? `The error names the fix: that command lives at \`${suggestion}\`. Run executeAux4 with command: ${fixed}`
      : `The error names the fix: that command lives at \`${suggestion}\`. Use that path with the same arguments.`;
  }
  const unknown = text.match(/Unknown parameter (--[\w.-]+), did you mean (--[\w.-]+)\?/);
  if (unknown) return `The error names the fix: use ${unknown[2]} instead of ${unknown[1]}, then run it again.`;
  if (/(?:Unknown|Unsupported|Unrecognized|Unexpected) (?:parameter|option|flag)\s*:?\s*--[\w.-]+/i.test(text)) {
    return "Read this command\'s exact --help, remove or replace the rejected option, then continue. Do not repeat already successful lookups to repair a parameter error.";
  }
  const missing = text.match(/Missing required parameter (--[\w.-]+)/);
  if (missing) return `The error names the fix: the call needs ${missing[1]} <value>. Add it (if you passed the value under another flag name, rename that flag to ${missing[1]}), then run it again.`;
  return "";
}

// The agent's command with its wrong leading words replaced by the suggested path:
// "ai agent browser find --url X" + "agent browser find" -> "agent browser find --url X".
export function correctedCommand(command, suggestion) {
  const words = String(suggestion || "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const tail = words.slice(-Math.min(2, words.length)).join(" ");
  const at = String(command || "").indexOf(tail);
  if (at < 0) return "";
  return `${words.join(" ")}${command.slice(at + tail.length)}`.trim();
}


function lookupPath(command) {
  let argv;
  try { argv = parseCommandArgs(String(command || "")); } catch { return null; }
  if (argv[0] === "aux4") argv = argv.slice(1);
  const flagAt = argv.findIndex(word => word.startsWith("--"));
  const path = flagAt < 0 ? argv : argv.slice(0, flagAt);
  if (!/^(?:list|search|find|query|lookup)$/i.test(path.at(-1) || "")) return null;
  return { argv, family: path.join(" ") };
}

export function isEmptyLookupResult(command, result) {
  if (!lookupPath(command)) return false;
  let data;
  try { data = typeof result === "string" ? JSON.parse(result) : result; } catch { return false; }
  if (Array.isArray(data)) return data.length === 0;
  if (!data || typeof data !== "object" || data.answered === true || data.found === true) return false;
  const containers = [data, ...(data.data && typeof data.data === "object" && !Array.isArray(data.data) ? [data.data] : [])];
  const arrays = containers.flatMap(container => Object.entries(container)
    .filter(([key, value]) => /^(?:items|records|messages|results|rows|entries|matches|events|value|data)$/i.test(key) && Array.isArray(value))
    .map(([, value]) => value));
  return arrays.length > 0 && arrays.every(array => array.length === 0);
}

export function emptyLookupRecovery(command, result) {
  const lookup = lookupPath(command);
  if (!lookup || !isEmptyLookupResult(command, result)
    || !lookup.argv.some(word => /^--(?:query|filter|search|q|where|timeMin|timeMax|labelIds)(?:=|$)/i.test(word))) return null;
  return { family: lookup.family, message: "A filtered lookup returned no matching records. That only rules out the current filters, not the named target. Try one materially broader lookup or inspect candidates with fewer optional filters, preserving every explicit user constraint. Do not repeat the same filters. If that also yields no relevant evidence, report what is missing." };
}

// A tool can explicitly report that a form is waiting for data. Authorization
// to submit does not supply those values; this feedback never confirms a call.
export function requiredInputRecovery(result) {
  let data;
  try { data = typeof result === "string" ? JSON.parse(result) : result; } catch { return null; }
  if (!data || data.status !== "needs-input" || !Array.isArray(data.confirmation?.emptyFields)) return null;
  const fields = data.confirmation.emptyFields.filter(value => typeof value === "string" && value.trim()).map(value => value.trim().slice(0, 120)).slice(0, 12);
  if (!fields.length) return null;
  return {
    key: JSON.stringify([data.confirmation.target || "", [...fields].sort()]),
    message: `The tool is waiting for required values: ${fields.join("; ")}. Authorization to submit does not supply missing data. Use values already present in the original request or successful evidence. If a required value is still absent, use one relevant available source; do not keep querying the same page or retry a denied source. If it cannot be obtained, stop with BLOCKED and name the missing value. Do not confirm or submit with empty or invented required values.`
  };
}


export function unansweredLookupRecovery(command, result) {
  const lookup=lookupPath(command);
  if (!lookup) return null;
  let data;
  try { data=typeof result === "string" ? JSON.parse(result) : result; } catch { return null; }
  if (!data || data.answered !== false) return null;
  return {family:lookup.family,message:"The lookup explicitly did not answer the question. Matching headings or labels do not establish the missing value. Inspect a relevant source or use one materially different available source, preserving the request's constraints. Do not keep rephrasing the same question against the same content. If the required fact is still unavailable, stop with BLOCKED and name it; do not invent it."};
}
