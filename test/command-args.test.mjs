import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommandArgs, buildAux4Argv, CommandParseError } from "../src/lib/CommandArgs.js";

// `command` here never includes a leading "aux4" — executeAux4 already strips/omits it;
// `aux4` is the spawn() binary, not an argv entry.
const cases = [
  ["x --q \"price $482.50\"", ["x", "--q", "price $482.50"]],
  ["x --url http://host/path?a=1&b=2", ["x", "--url", "http://host/path?a=1&b=2"]],
  ["x --url 'http://a.com/p?a=1&b=2#frag'", ["x", "--url", "http://a.com/p?a=1&b=2#frag"]],
  ["x --data '{\"zip\":\"90292\",\"q\":\"a b\"}'", ["x", "--data", "{\"zip\":\"90292\",\"q\":\"a b\"}"]],
  ["x --data \"{\\\"zip\\\":\\\"90292\\\"}\"", ["x", "--data", "{\"zip\":\"90292\"}"]],
  ["x --goal \"Find the city for ZIP 90292\"", ["x", "--goal", "Find the city for ZIP 90292"]],
  ["x   y\t\tz  ", ["x", "y", "z"]],
  ["x --name 'São Paulo — 東京 🚀'", ["x", "--name", "São Paulo — 東京 🚀"]],
  ["x $(touch /tmp/pwned)", ["x", "$(touch", "/tmp/pwned)"]],
  ["x `touch /tmp/pwned`", ["x", "`touch", "/tmp/pwned`"]],
  ["x \"$(whoami) $HOME `id`\"", ["x", "$(whoami) $HOME `id`"]],
  ["x $HOME ${PATH} ~ *", ["x", "$HOME", "${PATH}", "~", "*"]],
  ["kb update --content \"a\n\n**Reviewed:** x\"", ["kb", "update", "--content", "a\n\n**Reviewed:** x"]],
  ["x \"a\\nb\"", ["x", "a\\nb"]],
  ["x 'it'\\''s'", ["x", "it's"]],
  ["x a\\ b", ["x", "a b"]],
  ["x \"\" ''", ["x", "", ""]],
  ["x --k=\"v w\"", ["x", "--k=v w"]],
  ["x \"a\\\\b\\$c\"", ["x", "a\\b\\$c"]],
  ['x ";"', ["x", ";"]],
  ['x "a;b"', ["x", "a;b"]],
  ["x --url 'http://host?a=1;b=2'", ["x", "--url", "http://host?a=1;b=2"]],
];

for (const [input, expected] of cases) {
  test(`parseCommandArgs ${JSON.stringify(input)}`, () => {
    assert.deepEqual(parseCommandArgs(input), expected);
  });
}

test("unterminated quotes and trailing backslash throw", () => {
  for (const bad of ["x 'abc", "x \"abc", "x \\"]) {
    assert.throws(() => parseCommandArgs(bad), CommandParseError);
  }
});

test("buildAux4Argv parses a plain command", () => {
  assert.deepEqual(buildAux4Argv("pkger list"), ["pkger", "list"]);
  assert.deepEqual(buildAux4Argv(""), []);
});

test("buildAux4Argv rejects an unquoted chain operator as its own token", () => {
  for (const bad of [
    "x ; rm -rf /",
    "x && rm -rf /",
    "x || rm -rf /",
    "x | sh",
    "x > /tmp/pwned",
    "x < /etc/passwd",
  ]) {
    assert.throws(() => buildAux4Argv(bad), CommandParseError);
  }
});

test("buildAux4Argv allows the same characters quoted or embedded in a word", () => {
  assert.deepEqual(buildAux4Argv('x ";"'), ["x", ";"]);
  assert.deepEqual(buildAux4Argv("x --url http://h/p?a=1&b=2"), ["x", "--url", "http://h/p?a=1&b=2"]);
  assert.deepEqual(buildAux4Argv("x a;b"), ["x", "a;b"]);
});

test("buildAux4Argv drops a duplicated aux4 binary name", () => {
  assert.deepEqual(buildAux4Argv("aux4 aux4 version"), ["aux4", "version"]);
  assert.deepEqual(buildAux4Argv("aux4 version"), ["aux4", "version"]);
  assert.deepEqual(buildAux4Argv("aux4 pkger list"), ["aux4", "pkger", "list"]);
  assert.deepEqual(buildAux4Argv("'aux4' aux4 version"), ["aux4", "aux4", "version"]);
});
