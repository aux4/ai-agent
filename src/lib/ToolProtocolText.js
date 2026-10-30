// Return assistant text that is shaped like a serialized call to one of this
// turn's bound tools. The text is diagnostic evidence only; callers must never
// parse its arguments or invoke a tool from it.
export function malformedToolRequestText(response, boundTools = {}) {
  if (response?.tool_calls?.length) return null;

  const content = typeof response === "string" ? response : response?.content;
  const text = typeof content === "string"
    ? content.trim()
    : Array.isArray(content)
      ? content.filter(part => part?.type === "text" && typeof part.text === "string").map(part => part.text).join("").trim()
      : "";

  // A quoted or fenced example is ordinary assistant prose, even if it names
  // a tool. The model's malformed calls arrive as a bare serialization.
  if (!text || text.length > 8000 || /^(['"`]).*\1$/s.test(text) || /^```/.test(text)) return null;

  const names = Object.keys(boundTools).filter(name => name !== "__tool_protocol_error__");
  if (!names.length) return null;
  const alternatives = names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const shape = new RegExp(`^(?:call:)?(?:${alternatives})\\s*\\{[\\s\\S]*\\}(?:<tool_call\\|>)?$`);
  return shape.test(text) ? text : null;
}
