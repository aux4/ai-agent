// Parse an executeAux4 command string into an argv array WITHOUT a shell.
//
// executeAux4 spawns `aux4` directly with the parsed argv (no `sh -c`), so nothing in the
// string is ever interpreted by a shell: `;`, `&&`, `|`, `>`, backticks, `$(...)`, `$VAR`,
// globs and newlines are all plain argument text. aux4 commands escape their own params
// (value()/param()), so the argv reaches the command exactly as written.
//
// Quoting follows POSIX shell word rules so commands the model writes as it would type
// them in a terminal split the same way they did under `sh -c`:
//   - unquoted whitespace (space, tab, newline) separates words
//   - '...'  literal, no escapes
//   - "..."  backslash escapes only  $ ` " \  and newline (line continuation);
//            any other backslash is kept literally (`"a\nb"` stays `a\nb`)
//   - unquoted backslash escapes the next character; backslash-newline is removed
//   - adjacent quoted/unquoted pieces concatenate into one word; `""` is an empty word
// Unlike a shell, there is NO expansion of any kind ($VAR, $(...), `...`, ~, globs).
//
// Throws CommandParseError on an unterminated quote or a trailing lone backslash.

export class CommandParseError extends Error {}

const WHITESPACE = new Set([" ", "\t", "\n", "\r"]);
const DQ_ESCAPABLE = new Set(["$", "`", "\"", "\\", "\n"]);

export function parseCommandArgs(command) {
  const input = String(command ?? "");
  const args = [];
  let current = "";
  let inWord = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (WHITESPACE.has(ch)) {
      if (inWord) {
        args.push(current);
        current = "";
        inWord = false;
      }
      i++;
      continue;
    }

    if (ch === "'") {
      const end = input.indexOf("'", i + 1);
      if (end === -1) throw new CommandParseError("unterminated single quote");
      current += input.slice(i + 1, end);
      inWord = true;
      i = end + 1;
      continue;
    }

    if (ch === "\"") {
      i++;
      let closed = false;
      while (i < input.length) {
        const c = input[i];
        if (c === "\"") {
          closed = true;
          i++;
          break;
        }
        if (c === "\\" && i + 1 < input.length && DQ_ESCAPABLE.has(input[i + 1])) {
          if (input[i + 1] !== "\n") current += input[i + 1];
          i += 2;
          continue;
        }
        current += c;
        i++;
      }
      if (!closed) throw new CommandParseError("unterminated double quote");
      inWord = true;
      continue;
    }

    if (ch === "\\") {
      if (i + 1 >= input.length) throw new CommandParseError("trailing backslash");
      const next = input[i + 1];
      if (next === "\n") {
        // line continuation: removed entirely
        i += 2;
        continue;
      }
      current += next;
      inWord = true;
      i += 2;
      continue;
    }

    current += ch;
    inWord = true;
    i++;
  }

  if (inWord) args.push(current);
  return args;
}

// Build the argv passed to `spawn("aux4", argv)`: parse, then drop the leading `aux4`
// word. The caller has already normalized the command to its full form (leading `aux4`).
export function buildAux4Argv(fullCommand) {
  const args = parseCommandArgs(fullCommand);
  if (args[0] !== "aux4") {
    throw new CommandParseError("command must start with aux4");
  }
  return args.slice(1);
}
