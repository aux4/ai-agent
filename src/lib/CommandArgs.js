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

// Tokenize into { value, quoted, start, end } records. `quoted` is true if the token
// was produced (at least in part) inside quotes or via a backslash escape; source spans
// let route normalization remove only a proven redundant executable token.
function tokenize(command) {
  const input = String(command ?? "");
  const tokens = [];
  let current = "";
  let inWord = false;
  let sawQuoteOrEscape = false;
  let tokenStart = -1;
  let i = 0;

  function pushToken() {
    if (inWord) {
      tokens.push({ value: current, quoted: sawQuoteOrEscape, start: tokenStart, end: i });
      current = "";
      inWord = false;
      sawQuoteOrEscape = false;
      tokenStart = -1;
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
      if (!inWord) tokenStart = i;
      current += input.slice(i + 1, end);
      inWord = true;
      sawQuoteOrEscape = true;
      i = end + 1;
      continue;
    }

    if (ch === "\"") {
      if (!inWord) tokenStart = i;
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
      if (!inWord) tokenStart = i;
      current += input[i + 1];
      inWord = true;
      sawQuoteOrEscape = true;
      i += 2;
      continue;
    }

    if (!inWord) tokenStart = i;
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

// Build argv passed to `spawn("aux4", argv)`. Also retain whether a leading unquoted
// `aux4` can be a redundant executable prefix; route resolution decides whether to use it.
export function buildAux4Command(command) {
  const input = String(command ?? "");
  const tokens = tokenize(command);
  const rawTokens = tokens.slice();
  const op = findChainOperator(tokens);
  if (op) {
    throw new CommandParseError(
      `unquoted "${op}" is not supported — executeAux4 runs a single aux4 command with no shell, so chaining/redirection operators do nothing. Quote it ('...' or "...") if you meant it literally, or make one executeAux4 call per command`
    );
  }
  // A model that writes the full command line ("aux4 aux4 version", copied from a
  // task or a doc) means the `aux4` binary itself: `aux4 aux4 aux4 ...` is never a
  // real command, so drop the duplicated binary name.
  let droppedBinaryPrefix = false;
  if (tokens.length >= 2 && !tokens[0].quoted && tokens[0].value === "aux4" && !tokens[1].quoted && tokens[1].value === "aux4") {
    tokens.shift();
    droppedBinaryPrefix = true;
  }

  const hasExecutablePrefix = tokens.length > 0 && !tokens[0].quoted && tokens[0].value === "aux4";
  let withoutExecutablePrefix = null;
  if (hasExecutablePrefix) {
    // A duplicated binary name was already consumed above; a fallback after that
    // must also remove the next raw token, which still represents the redundant
    // executable prefix in the original command string.
    const tokensToRemove = droppedBinaryPrefix ? 2 : 1;
    const lastRemoved = rawTokens[tokensToRemove - 1];
    if (lastRemoved) withoutExecutablePrefix = input.slice(lastRemoved.end).trimStart();
  }

  return {
    argv: tokens.map((t) => t.value),
    hasExecutablePrefix,
    withoutExecutablePrefix
  };
}

export function buildAux4Argv(command) {
  return buildAux4Command(command).argv;
}
