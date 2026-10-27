// Parse an executeAux4 command string into an argv array WITHOUT a shell.
//
// executeAux4 spawns `aux4` directly with the parsed argv (no `sh -c`), so nothing in the
// string is ever interpreted by a shell: `;`, `&&`, `|`, `>`, `<`, backticks, `$(...)`,
// `${...}`, bare `$VAR` and newlines are all plain argument text once they are part of a
// word. aux4 commands escape their own params (value()/param()), so the argv reaches the
// command exactly as written — in particular `$9.99` and `?a=1&b=2` arrive unchanged,
// which a shell (even with the old operator guard) would mangle or reject.
//
// Quoting follows POSIX shell word rules so commands the model writes as it would type
// them in a terminal split the same way they did under `sh -c`:
//   - unquoted whitespace (space, tab, newline) separates words
//   - '...'  literal, no escapes
//   - "..."  backslash escapes only  \ and "  (NO $ expansion — this tokenizer never
//            expands anything, so a lone backslash before any other character, including
//            $ and `, is kept literally)
//   - unquoted backslash escapes the next character
//   - adjacent quoted/unquoted pieces concatenate into one word; `""` is an empty word
// There is NO expansion of any kind ($VAR, $(...), `...`, ~, globs) — quoted or not.
//
// Throws CommandParseError on an unterminated quote or a trailing lone backslash.
//
// Chaining detection: a model that writes an UNQUOTED `;`, `|`, `&&`, `||`, `>` or `<` as
// its own token almost always meant shell chaining/redirection, which cannot run here —
// the token would just be passed to `aux4` as a literal (and useless) argument. Reject
// those early with a clear message. A `&` that is part of a larger word (e.g. a URL
// `?a=1&b=2`) is NOT an operator token and passes through untouched.

export class CommandParseError extends Error {}

const WHITESPACE = new Set([" ", "\t", "\n", "\r"]);
const DQ_ESCAPABLE = new Set(["\"", "\\"]);
const CHAIN_OPERATORS = new Set([";", "|", "||", "&&", ">", "<"]);

// Tokenize into { value, quoted } pairs. `quoted` is true if the token was produced (at
// least in part) inside quotes or via a backslash escape — used to tell a literal `;`
// the model typed inside quotes from a bare, unquoted chaining operator.
function tokenize(command) {
  const input = String(command ?? "");
  const tokens = [];
  let current = "";
  let inWord = false;
  let sawQuoteOrEscape = false;
  let i = 0;

  function pushToken() {
    if (inWord) {
      tokens.push({ value: current, quoted: sawQuoteOrEscape });
      current = "";
      inWord = false;
      sawQuoteOrEscape = false;
    }
  }

  while (i < input.length) {
    const ch = input[i];

    if (WHITESPACE.has(ch)) {
      pushToken();
      i++;
      continue;
    }

    if (ch === "'") {
      const end = input.indexOf("'", i + 1);
      if (end === -1) throw new CommandParseError("unterminated single quote");
      current += input.slice(i + 1, end);
      inWord = true;
      sawQuoteOrEscape = true;
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
          current += input[i + 1];
          i += 2;
          continue;
        }
        current += c;
        i++;
      }
      if (!closed) throw new CommandParseError("unterminated double quote");
      inWord = true;
      sawQuoteOrEscape = true;
      continue;
    }

    if (ch === "\\") {
      if (i + 1 >= input.length) throw new CommandParseError("trailing backslash");
      current += input[i + 1];
      inWord = true;
      sawQuoteOrEscape = true;
      i += 2;
      continue;
    }

    current += ch;
    inWord = true;
    i++;
  }

  pushToken();
  return tokens;
}

export function parseCommandArgs(command) {
  return tokenize(command).map((t) => t.value);
}

// Reject an UNQUOTED chaining/redirection operator that stands as its own token (e.g.
// `aux4 x ; rm -rf /` splits into the token `;`). A quoted `";"` or a character that is
// merely part of a larger word (`a&b`, `?a=1&b=2`) is never flagged.
function findChainOperator(tokens) {
  for (const t of tokens) {
    if (!t.quoted && CHAIN_OPERATORS.has(t.value)) return t.value;
  }
  return null;
}

// Build the argv passed to `spawn("aux4", argv)`. `command` is the string the model
// supplied to executeAux4 WITHOUT a leading `aux4` (that binary name is the spawn target,
// not an argument).
export function buildAux4Argv(command) {
  const tokens = tokenize(command);
  const op = findChainOperator(tokens);
  if (op) {
    throw new CommandParseError(
      `unquoted "${op}" is not supported — executeAux4 runs a single aux4 command with no shell, so chaining/redirection operators do nothing. Quote it ('...' or "...") if you meant it literally, or make one executeAux4 call per command`
    );
  }
  // A model that writes the full command line ("aux4 aux4 version", copied from a
  // task or a doc) means the `aux4` binary itself: `aux4 aux4 aux4 ...` is never a
  // real command, so drop the duplicated binary name.
  if (tokens.length >= 2 && !tokens[0].quoted && tokens[0].value === "aux4" && !tokens[1].quoted && tokens[1].value === "aux4") {
    tokens.shift();
  }
  return tokens.map((t) => t.value);
}
