// Glob/permission pattern matching shared by Tools.js (static permissions) and
// Policy.js (policy allow/deny). Kept dependency-free so it can be imported without
// pulling in the LangChain tool definitions.

// Convert a glob pattern (with * wildcards) to a RegExp and test it against a string.
export function matchesPattern(subject, pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  // "s" (dotall) so a `*` wildcard matches across newlines — commands/paths can contain
  // newlines (e.g. an `aux4 kb update --content "line1\n\nline2"`), and without dotall
  // the pattern would fail to match its own allowed command.
  const regex = new RegExp("^" + escaped.replace(/\*/g, ".*") + "$", "s");
  return regex.test(subject);
}

// Parse a permission pattern into its type and matching pattern.
// Returns { type: "command"|"file", scope?: string, pattern: string }
export function parsePattern(pattern) {
  const fileMatch = pattern.match(/^file:(read|write|delete):(.+)$/);
  if (fileMatch) {
    return { type: "file", scope: fileMatch[1], pattern: fileMatch[2] };
  }
  // Strip optional aux4: prefix for command patterns
  const cmdPattern = pattern.startsWith("aux4:") ? pattern.slice(5) : pattern;
  return { type: "command", pattern: cmdPattern };
}
