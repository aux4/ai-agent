import { test } from "node:test";
import assert from "node:assert/strict";
import { hasShellControlChar } from "../src/lib/ShellControlGuard.js";

test("allows a quoted menu path with a literal '>' in double quotes", () => {
  assert.equal(
    hasShellControlChar('aux4 computer menu --app TextEdit --path "File > Save As…"'),
    false
  );
});

test("allows a quoted menu path with a literal '>' in single quotes", () => {
  assert.equal(
    hasShellControlChar("aux4 computer menu --app TextEdit --path 'Edit > Select All'"),
    false
  );
});

test("allows quoted chain-looking operators in double quotes", () => {
  assert.equal(
    hasShellControlChar('aux4 x --text "a; b | c & d"'),
    false
  );
});

test("rejects an unquoted command chain", () => {
  assert.equal(hasShellControlChar("aux4 x; rm -rf ~"), true);
});

test("rejects command substitution inside double quotes", () => {
  assert.equal(hasShellControlChar('aux4 x "$(id)"'), true);
});

test("rejects a backtick inside double quotes", () => {
  assert.equal(hasShellControlChar('aux4 x "`id`"'), true);
});

test("rejects variable expansion ${...} inside double quotes", () => {
  assert.equal(hasShellControlChar('aux4 x "${HOME}"'), true);
});

test("rejects an unquoted redirect after a quoted argument", () => {
  assert.equal(hasShellControlChar("aux4 x 'a' > f"), true);
});

test("rejects an unterminated double quote", () => {
  assert.equal(hasShellControlChar('aux4 x "unterminated'), true);
});

test("rejects an unterminated single quote", () => {
  assert.equal(hasShellControlChar("aux4 x 'unterminated"), true);
});

test("rejects an escaped quote followed by a real chain operator", () => {
  assert.equal(hasShellControlChar('aux4 x \\"; id'), true);
});

test("rejects a raw newline embedded in a single-quoted string", () => {
  assert.equal(hasShellControlChar("aux4 x 'a\nb'"), true);
});

test("rejects an unquoted pipe", () => {
  assert.equal(hasShellControlChar("aux4 x | sh"), true);
});

test("rejects an unquoted less-than redirect", () => {
  assert.equal(hasShellControlChar("aux4 x < secrets.txt"), true);
});

test("rejects an unquoted ampersand", () => {
  assert.equal(hasShellControlChar("aux4 x & rm -rf ~"), true);
});

test("rejects a backslash-newline outside quotes", () => {
  assert.equal(hasShellControlChar("aux4 x \\\nrm -rf ~"), true);
});

test("allows a backslash-escaped ordinary character outside quotes", () => {
  assert.equal(hasShellControlChar("aux4 x \\* y"), false);
});

test("allows a backslash-newline continuation inside double quotes", () => {
  assert.equal(hasShellControlChar('aux4 x "line one \\\nline two"'), false);
});

test("allows a plain bare command with no operators", () => {
  assert.equal(hasShellControlChar("aux4 ai agent ask --question hi"), false);
});
