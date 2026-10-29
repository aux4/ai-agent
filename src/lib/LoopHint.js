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
