// Keyless regression check for AGC-016: content with shell metacharacters
// (backticks, $(), ;, &&, |, quotes, newlines) passed to executeAux4 must NOT
// be shell-interpreted. executeAux4 is only driven by the LLM at runtime, so
// there is no keyless CLI entry point; this script exercises the exact code the
// tool uses — buildAux4Argv (the argv tokenizer) plus a direct, shell-less
// `aux4` spawn — and verifies the content round-trips verbatim through a real
// `aux4 kb add`. Prints "SHELL-SAFETY OK" on success; exits non-zero otherwise.
import { buildAux4Argv } from "../../src/lib/CommandParser.js";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL: " + msg);
    process.exit(1);
  }
}

function argvEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// 1. Argv tokenization keeps every metacharacter literal (no substitution).
assert(
  argvEqual(
    buildAux4Argv('kb add --topic "t" --content "run `whoami` and $(id -un)"'),
    ["aux4", "kb", "add", "--topic", "t", "--content", "run `whoami` and $(id -un)"]
  ),
  "backticks and $() must survive as literal argv"
);

assert(
  argvEqual(
    buildAux4Argv('kb add --content "a ; b && c | d"'),
    ["aux4", "kb", "add", "--content", "a ; b && c | d"]
  ),
  "; && | must survive as literal argv"
);

assert(
  argvEqual(
    buildAux4Argv("config get 'my key'"),
    ["aux4", "config", "get", "my key"]
  ),
  "single quotes group values with spaces"
);

assert(
  argvEqual(
    buildAux4Argv('kb add --content "line1\nline2 `cmd`"'),
    ["aux4", "kb", "add", "--content", "line1\nline2 `cmd`"]
  ),
  "newlines inside quotes are preserved"
);

assert(
  argvEqual(buildAux4Argv('kb add --content ""'), ["aux4", "kb", "add", "--content", ""]),
  "empty quoted argument is preserved"
);

// 2. Malformed quoting is reported, not silently mis-executed.
let threw = false;
try {
  buildAux4Argv('kb add --content "unterminated');
} catch {
  threw = true;
}
assert(threw, "unterminated quote must throw");

// 3. End-to-end: the exact executeAux4 mechanism (parse -> shell-less spawn of
//    aux4) must store metacharacter content verbatim via a real `aux4 kb add`.
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "agc016-kb-"));
const payload = "inspect fields with `aux4 pdf parse`, fill with $(aux4 pdf fill); done && ok | end";
const argv = buildAux4Argv(
  `kb add --folder ${folder} --topic "pdf gotcha" --tags pdf --content "${payload}"`
);
const result = spawnSync(argv[0], argv.slice(1), { encoding: "utf-8" });
assert(result.status === 0, `aux4 kb add failed: ${result.stderr || result.stdout}`);

const files = fs.readdirSync(folder).filter((f) => f.endsWith(".md"));
assert(files.length === 1, `expected one stored note, found ${files.length}`);
const stored = fs.readFileSync(path.join(folder, files[0]), "utf-8");
assert(
  stored.includes(payload),
  `stored content was mangled by the shell.\n  expected substring: ${payload}\n  got:\n${stored}`
);

fs.rmSync(folder, { recursive: true, force: true });
console.log("SHELL-SAFETY OK");
