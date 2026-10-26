import fs from "fs";
import path from "path";
import { listSkills } from "./Skills.js";

// Pure, side-effect-free checks that decide whether a given optional tool should be bound at
// all, used by Tools.js#createTools. Kept in their own module (no ?raw imports, no __dirname)
// so they can be unit tested by importing this file directly with plain `node --test`.

// A storage directory only counts as "configured" when it actually holds an index --
// LlmStore.load() uses the very same docstore.json marker to decide whether to load a FAISS
// store at all. A bare default path (e.g. the CLI's ".context" default) that nothing has ever
// learned into is NOT configured storage.
export function hasConfiguredStorage(storage) {
  if (!storage) return false;
  try {
    return fs.existsSync(path.resolve(storage)) && fs.existsSync(path.join(path.resolve(storage), "docstore.json"));
  } catch {
    return false;
  }
}

// A references directory only counts as configured when it exists and contains at least one
// .md reference document (recursively) -- an unset/missing/empty directory means there is
// nothing for readReference to ever return.
export function hasReferences(referencesDir) {
  if (!referencesDir) return false;
  let resolved;
  try {
    resolved = path.resolve(referencesDir);
    if (!fs.existsSync(resolved)) return false;
  } catch {
    return false;
  }

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (walk(full)) return true;
      } else if (entry.name.endsWith(".md")) {
        return true;
      }
    }
    return false;
  }

  return walk(resolved);
}

// A skills directory only counts as configured when it has at least one subdirectory with a
// SKILL.md -- reuses the same listSkills() the readSkill tool and the skills catalog use, so
// the three never disagree about what's "available".
export function hasSkills(skillsDir) {
  if (!skillsDir) return false;
  return listSkills(skillsDir).length > 0;
}
