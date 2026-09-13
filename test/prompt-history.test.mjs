import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureParentDirectorySync } from "../src/lib/util/FileUtils.js";

test("history persistence creates a missing execution-state directory", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aux4-agent-history-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const historyFile = path.join(root, "state", "agent-sessions", "execution.json");

  ensureParentDirectorySync(historyFile);
  fs.writeFileSync(historyFile, JSON.stringify({ question: "What is r2-3?" }));

  const saved = JSON.parse(fs.readFileSync(historyFile, "utf8"));
  assert.equal(saved.question, "What is r2-3?");
});
