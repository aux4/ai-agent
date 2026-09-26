import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommandArgs, buildAux4Argv, CommandParseError } from "../src/lib/CommandArgs.js";

const cases = [
  ["aux4 cloud browser read --url https://tools.usps.com/zip-code-lookup.htm?byzipcode&zipcode=90292",
    ["aux4", "cloud", "browser", "read", "--url", "https://tools.usps.com/zip-code-lookup.htm?byzipcode&zipcode=90292"]],
  ["aux4 x --url 'https://a.com/p?a=1&b=2#frag'", ["aux4", "x", "--url", "https://a.com/p?a=1&b=2#frag"]],
  ["aux4 x --data '{\"zip\":\"90292\",\"q\":\"a b\"}'", ["aux4", "x", "--data", "{\"zip\":\"90292\",\"q\":\"a b\"}"]],
  ["aux4 x --data \"{\\\"zip\\\":\\\"90292\\\"}\"", ["aux4", "x", "--data", "{\"zip\":\"90292\"}"]],
  ["aux4 x --goal \"Find the city for ZIP 90292\"", ["aux4", "x", "--goal", "Find the city for ZIP 90292"]],
  ["aux4   x\t\ty  ", ["aux4", "x", "y"]],
  ["aux4 x --name 'São Paulo — 東京 🚀'", ["aux4", "x", "--name", "São Paulo — 東京 🚀"]],
  ["aux4 x; rm -rf /", ["aux4", "x;", "rm", "-rf", "/"]],
  ["aux4 x && aux4 y || z", ["aux4", "x", "&&", "aux4", "y", "||", "z"]],
  ["aux4 x | sh", ["aux4", "x", "|", "sh"]],
  ["aux4 x > /tmp/pwned", ["aux4", "x", ">", "/tmp/pwned"]],
  ["aux4 x $(touch /tmp/pwned)", ["aux4", "x", "$(touch", "/tmp/pwned)"]],
  ["aux4 x `touch /tmp/pwned`", ["aux4", "x", "`touch", "/tmp/pwned`"]],
  ["aux4 x \"$(whoami) $HOME `id`\"", ["aux4", "x", "$(whoami) $HOME `id`"]],
  ["aux4 x $HOME ${PATH} ~ *", ["aux4", "x", "$HOME", "${PATH}", "~", "*"]],
  ["aux4 x\nrm -rf /", ["aux4", "x", "rm", "-rf", "/"]],
  ["aux4 kb update --content \"a\n\n**Reviewed:** x\"", ["aux4", "kb", "update", "--content", "a\n\n**Reviewed:** x"]],
  ["aux4 x \"a\\nb\"", ["aux4", "x", "a\\nb"]],
  ["aux4 x 'it'\\''s'", ["aux4", "x", "it's"]],
  ["aux4 x a\\ b", ["aux4", "x", "a b"]],
  ["aux4 x \"\" ''", ["aux4", "x", "", ""]],
  ["aux4 x --k=\"v w\"", ["aux4", "x", "--k=v w"]],
  ["aux4 x \\\nnext", ["aux4", "x", "next"]],
  ["aux4 x \"a\\\\b\\$c\"", ["aux4", "x", "a\\b$c"]],
];

for (const [input, expected] of cases) {
  test(`parse ${JSON.stringify(input)}`, () => {
    assert.deepEqual(parseCommandArgs(input), expected);
  });
}

test("unterminated quotes and trailing backslash throw", () => {
  for (const bad of ["aux4 x 'abc", "aux4 x \"abc", "aux4 x \\"]) {
    assert.throws(() => parseCommandArgs(bad), CommandParseError);
  }
});

test("buildAux4Argv drops the leading aux4 and requires it", () => {
  assert.deepEqual(buildAux4Argv("aux4 aux4 pkger list"), ["aux4", "pkger", "list"]);
  assert.deepEqual(buildAux4Argv("aux4"), []);
  assert.throws(() => buildAux4Argv("'aux4x' y"), CommandParseError);
});
