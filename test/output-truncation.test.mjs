import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readOutputFile } from "../src/lib/Tools.js";

test("large command output keeps both its beginning and end", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "output-truncation-test-"));
  const file = path.join(dir, "output.txt");
  fs.writeFileSync(file, `START status=needs-input ${"x".repeat(500)} confirmation-contract ${"y".repeat(500)} END diagnostic`);

  const output = readOutputFile(file, 120);
  assert.match(output, /^START status=needs-input/);
  assert.match(output, /\[\.\.\.truncated\.\.\.\]/);
  assert.match(output, /END diagnostic$/);
  fs.rmSync(dir, { recursive: true, force: true });
});
