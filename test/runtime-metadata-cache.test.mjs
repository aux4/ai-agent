import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  clearRuntimeMetadataCache,
  loadSkillsCatalogMetadata,
  readRuntimeMetadata
} from "../src/lib/RuntimeMetadataCache.js";

test("runtime metadata cache is path-isolated and invalidates when a file changes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aux4-ai-metadata-"));
  try {
    clearRuntimeMetadataCache();
    const first = path.join(dir, "first.md");
    const second = path.join(dir, "second.md");
    await writeFile(first, "first-v1");
    await writeFile(second, "second-v1");

    assert.deepEqual(await readRuntimeMetadata(first), { value: "first-v1", cacheHit: false });
    assert.deepEqual(await readRuntimeMetadata(first), { value: "first-v1", cacheHit: true });
    assert.deepEqual(await readRuntimeMetadata(second), { value: "second-v1", cacheHit: false });

    await writeFile(first, "first-version-two");
    assert.deepEqual(await readRuntimeMetadata(first), { value: "first-version-two", cacheHit: false });
    assert.deepEqual(await readRuntimeMetadata(second), { value: "second-v1", cacheHit: true });
  } finally {
    clearRuntimeMetadataCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("skills catalog cache invalidates from the skill file identity", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aux4-ai-skills-"));
  try {
    clearRuntimeMetadataCache();
    const skillDir = path.join(dir, "alpha");
    await mkdir(skillDir);
    const skillFile = path.join(skillDir, "SKILL.md");
    await writeFile(skillFile, "---\nname: alpha\ndescription: first description\n---\n");

    const initial = await loadSkillsCatalogMetadata(dir);
    assert.equal(initial.cacheHit, false);
    assert.match(initial.value, /first description/);
    assert.equal((await loadSkillsCatalogMetadata(dir)).cacheHit, true);

    await writeFile(skillFile, "---\nname: alpha\ndescription: changed description here\n---\n");
    const changed = await loadSkillsCatalogMetadata(dir);
    assert.equal(changed.cacheHit, false);
    assert.match(changed.value, /changed description here/);
  } finally {
    clearRuntimeMetadataCache();
    await rm(dir, { recursive: true, force: true });
  }
});
