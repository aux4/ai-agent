import os from "os";

// Tokenize a command line into an argv array WITHOUT any shell interpretation.
//
// Supports POSIX-style single/double quoting, backslash escaping, and
// whitespace word-splitting only. It deliberately does NOT perform command
// substitution (backticks or $(...)), variable expansion, globbing, pipes,
// or redirection — every character inside an argument value is passed through
// literally. This is what makes executeAux4 safe against shell injection when
// the agent passes arbitrary content (for example `kb add --content "..."`
// where the content contains markdown backticks, $(), ;, &&, |, or quotes).
//
// Returns an array of { value, quoted } tokens. Throws on an unterminated
// quote so the caller can report a clear error.
export function tokenizeCommand(input) {
  const tokens = [];
  let current = "";
  let started = false; // whether the current token has any characters (keeps "" quoted args)
  let quoted = false; // whether the current token used any quoting (skips tilde expansion)
  let i = 0;
  const n = input.length;

  const flush = () => {
    if (started) {
      tokens.push({ value: current, quoted });
      current = "";
      started = false;
      quoted = false;
    }
  };

  while (i < n) {
    const ch = input[i];

    if (ch === "'") {
      // single-quoted: everything is literal until the closing quote
      started = true;
      quoted = true;
      i++;
      let closed = false;
      while (i < n) {
        if (input[i] === "'") {
          closed = true;
          i++;
          break;
        }
        current += input[i++];
      }
      if (!closed) throw new Error("unterminated single quote");
      continue;
    }

    if (ch === "\"") {
      // double-quoted: literal, but a backslash escapes " \ ` or $ so the agent
      // can still include those characters. No substitution is performed.
      started = true;
      quoted = true;
      i++;
      let closed = false;
      while (i < n) {
        const c = input[i];
        if (c === "\"") {
          closed = true;
          i++;
          break;
        }
        if (c === "\\" && i + 1 < n && "\"\\`$".includes(input[i + 1])) {
          current += input[i + 1];
          i += 2;
          continue;
        }
        current += c;
        i++;
      }
      if (!closed) throw new Error("unterminated double quote");
      continue;
    }

    if (ch === "\\") {
      // backslash escapes the next character outside quotes
      started = true;
      if (i + 1 < n) {
        current += input[i + 1];
        i += 2;
      } else {
        current += ch;
        i++;
      }
      continue;
    }

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      flush();
      i++;
      continue;
    }

    current += ch;
    started = true;
    i++;
  }

  flush();
  return tokens;
}

// Expand a leading ~ to the home directory, but ONLY for unquoted tokens.
// Quoted values (for example a note that literally contains "~/path") are left
// untouched so content is never rewritten.
export function expandTildeToken(token) {
  if (token.quoted) return token.value;
  const home = os.homedir();
  if (token.value === "~") return home;
  if (token.value.startsWith("~/")) return home + token.value.slice(1);
  return token.value;
}

// Build the argv for `aux4 <command>` from the agent-provided command string,
// without going through a shell. Throws on malformed quoting.
export function buildAux4Argv(command) {
  const tokens = tokenizeCommand(command);
  return ["aux4", ...tokens.map(expandTildeToken)];
}
