// When the repeated result is aux4's own parameter error, it already names the fix; a small
// model that re-reads only "do not repeat" tends to wander off instead of changing the flag.
export function repeatFixHint(result) {
  const text = String(result || "");
  const unknown = text.match(/Unknown parameter (--[\w.-]+), did you mean (--[\w.-]+)\?/);
  if (unknown) return `The error names the fix: use ${unknown[2]} instead of ${unknown[1]}, then run it again.`;
  const missing = text.match(/Missing required parameter (--[\w.-]+)/);
  if (missing) return `The error names the fix: the call needs ${missing[1]} <value>. Add it (if you passed the value under another flag name, rename that flag to ${missing[1]}), then run it again.`;
  return "";
}
