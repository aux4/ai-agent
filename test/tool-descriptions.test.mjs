import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Tools, { createTools } from "../src/lib/Tools.js";
import * as Descriptions from "../src/docs/tools/descriptions.js";

// Budget: the total size of the descriptions actually sent to the model on every call must stay
// small. These are the markdown "user manuals" HARN-032 replaced with short, model-facing text --
// this guards against someone pasting a long doc back into a description.
const TOTAL_BUDGET = 8000;
const PER_TOOL_BUDGET = 1500; // generous ceiling per tool
// executeAux4 deliberately keeps its full doc as its description (see descriptions.js).
const FULL_DOC_TOOLS = new Set(["executeAux4Desc"]);

test("every short tool description stays well under the per-tool budget", () => {
  for (const [name, desc] of Object.entries(Descriptions)) {
    if (FULL_DOC_TOOLS.has(name)) continue;
    assert.ok(typeof desc === "string" && desc.length > 0, `${name} should be a non-empty string`);
    assert.ok(
      desc.length <= PER_TOOL_BUDGET,
      `${name} description is ${desc.length} chars, over the ${PER_TOOL_BUDGET} budget`
    );
  }
});

test("total description size of the default bound tools stays under budget", () => {
  const total = Object.values(Tools).reduce((sum, t) => sum + String(t.description || "").length, 0);
  assert.ok(total < TOTAL_BUDGET, `total description size is ${total}, expected < ${TOTAL_BUDGET}`);
});

test("createTools with no storage/references/skills configured does not bind searchContext/readReference/readSkill", () => {
  const tools = createTools({});
  assert.equal(tools.searchContext, undefined);
  assert.equal(tools.readReference, undefined);
  assert.equal(tools.readSkill, undefined);
  // The always-available tools must still be there.
  assert.ok(tools.readFile);
  assert.ok(tools.executeAux4);
});

test("createTools binds searchContext when a storage directory has an actual vector store", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-agent-storage-"));
  try {
    // No docstore.json yet -- not configured.
    assert.equal(createTools({ storage: dir }).searchContext, undefined);

    // Write the same marker file LlmStore.load() checks for.
    fs.writeFileSync(path.join(dir, "docstore.json"), "[]");
    assert.ok(createTools({ storage: dir }).searchContext);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("createTools binds readReference only when the references directory has a .md file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-agent-references-"));
  try {
    assert.equal(createTools({ references: dir }).readReference, undefined);

    fs.writeFileSync(path.join(dir, "topic.md"), "# Topic\n");
    assert.ok(createTools({ references: dir }).readReference);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("createTools binds readSkill only when the skills directory has a skill with SKILL.md", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-agent-skills-"));
  try {
    assert.equal(createTools({ skills: dir }).readSkill, undefined);

    const skillDir = path.join(dir, "my-skill");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: my-skill\ndescription: test\n---\nDo the thing.");
    assert.ok(createTools({ skills: dir }).readSkill);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a non-existent references/skills/storage path (e.g. the CLI's own defaults) never binds the optional tools", () => {
  // Mirrors AskExecutor's defaults: storage=".context", skills=".agents/skills",
  // references=<packageDir>/references -- none of which exist in a throwaway cwd.
  const tools = createTools({ storage: ".context-does-not-exist", skills: ".agents/skills-does-not-exist", references: "./references-does-not-exist" });
  assert.equal(tools.searchContext, undefined);
  assert.equal(tools.readReference, undefined);
  assert.equal(tools.readSkill, undefined);
});

test("executeAux4's description is its full doc, verbatim", () => {
  const doc = fs.readFileSync(new URL("../src/docs/tools/executeAux4.md", import.meta.url), "utf8");
  assert.equal(Descriptions.executeAux4Desc, doc);
});
