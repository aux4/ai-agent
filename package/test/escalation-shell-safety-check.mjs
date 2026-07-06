// Keyless regression check for HARN-015: escalation context values injected
// into an escalate command (${reason}, ${json}, ${action}, ...) must NOT be
// shell-interpreted. Escalations previously ran through spawnSync("sh", ["-c",
// ...]) with the values spliced into the command STRING, so backticks, $(), ;,
// &&, |, quotes and newlines inside a value were command-substituted / word-split
// before aux4 saw them (same injection class AGC-016 fixed for executeAux4).
//
// Escalation now builds an argv with buildEscalationArgv (tokenize the template,
// then substitute ${var} INTO each argv token) and spawns `aux4` directly with
// no shell. This script exercises that exact code and verifies a value with
// every metacharacter round-trips verbatim through a real `aux4 kb add`.
// Prints "ESCALATION-SHELL-SAFETY OK" on success; exits non-zero otherwise.
import { buildEscalationArgv } from "../../src/lib/Escalation.js";
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

// A hostile context: every value carries shell metacharacters. If any of these
// were shell-interpreted, the argv below would differ or the round-trip would
// be mangled.
const ctx = {
  trigger: "budget",
  reason: "stop `whoami` and $(id -un); rm -rf / && echo pwned | tee \"x\"\nsecond line",
  agent: "test",
  runId: "run_1",
  action: "executeAux4: db drop",
  spent: 42,
  cap: 10,
  escalationId: "esc_deadbeef"
};

// 1. A bare ${reason} token becomes ONE literal argv element, even though the
//    value contains spaces, quotes, newlines, backticks, $(), ;, && and |.
const argv1 = buildEscalationArgv('kb add --topic "esc" --content ${reason}', ctx);
assert(
  argvEqual(argv1, ["aux4", "kb", "add", "--topic", "esc", "--content", ctx.reason]),
  `bare \${reason} must be one literal argv element, got: ${JSON.stringify(argv1)}`
);

// 2. ${json} (a JSON blob with quotes/braces) also lands as a single argv token.
const argv2 = buildEscalationArgv("todo add --message ${json}", ctx);
assert(argv2.length === 5, `\${json} must be a single argv element, got: ${JSON.stringify(argv2)}`);
const parsed = JSON.parse(argv2[4]);
assert(parsed.reason === ctx.reason, "json argv element must contain the raw reason, unmodified");
assert(parsed.action === ctx.action, "json argv element must contain the raw action, unmodified");

// 3. A value embedded INSIDE a quoted template token stays in one argv element
//    (substitution is post-tokenization, so it can't break out of the quotes).
const argv3 = buildEscalationArgv('log:"reason was: ${reason}"', ctx);
assert(
  argvEqual(argv3, ["aux4", `log:reason was: ${ctx.reason}`]),
  `embedded \${reason} must not split the token, got: ${JSON.stringify(argv3)}`
);

// 4. Injected values are never tilde-expanded (only unquoted TEMPLATE tokens are).
const tildeCtx = { ...ctx, reason: "~/should-stay-literal" };
const argv4 = buildEscalationArgv("kb add --content ${reason}", tildeCtx);
assert(
  argv4[argv4.length - 1] === "~/should-stay-literal",
  `injected value must not be tilde-expanded, got: ${JSON.stringify(argv4)}`
);

// 5. Malformed quoting in the template is reported, not silently mis-executed.
let threw = false;
try {
  buildEscalationArgv('kb add --content "unterminated ${reason}', ctx);
} catch {
  threw = true;
}
assert(threw, "unterminated quote in template must throw");

// 6. End-to-end: the exact escalation mechanism (buildEscalationArgv -> shell-less
//    aux4 spawn) must store the metacharacter-laden reason verbatim. If a shell
//    were involved, `whoami`/$(id -un) would execute and the ; && | would split
//    the command, corrupting the stored note.
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "harn015-kb-"));
const e2eCtx = {
  ...ctx,
  reason: "inspect with `aux4 pdf parse`, fill with $(aux4 pdf fill); done && ok | end"
};
const argv = buildEscalationArgv(
  `kb add --folder ${folder} --topic "escalation gotcha" --tags policy --content \${reason}`,
  e2eCtx
);
const result = spawnSync(argv[0], argv.slice(1), { encoding: "utf-8" });
assert(result.status === 0, `aux4 kb add failed: ${result.stderr || result.stdout}`);

const files = fs.readdirSync(folder).filter(f => f.endsWith(".md"));
assert(files.length === 1, `expected one stored note, found ${files.length}`);
const stored = fs.readFileSync(path.join(folder, files[0]), "utf-8");
assert(
  stored.includes(e2eCtx.reason),
  `stored escalation content was mangled by a shell.\n  expected substring: ${e2eCtx.reason}\n  got:\n${stored}`
);

fs.rmSync(folder, { recursive: true, force: true });
console.log("ESCALATION-SHELL-SAFETY OK");
