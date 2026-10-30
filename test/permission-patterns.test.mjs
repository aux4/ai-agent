import test from "node:test";
import assert from "node:assert/strict";
import {matchesPattern} from "../src/lib/PatternUtils.js";
import {checkPermission} from "../src/lib/Tools.js";

test("permission wildcards cover quoted multiline data for both grants and denials", () => {
  const command = 'messages send --body "First line\nSecond line" --to teammate@example.test';
  assert.equal(matchesPattern(command, "messages send*"), true);
  assert.equal(checkPermission(command, {allow:["messages send*"]}), "allow");
  assert.equal(checkPermission(command, {allow:["messages send*"], deny:["*--to teammate@example.test*"]}), "deny");
  assert.equal(checkPermission(command, {allow:["messages list*"]}), "deny");
});
