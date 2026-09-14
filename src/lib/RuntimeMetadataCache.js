import fs from "node:fs/promises";
import path from "node:path";

import { loadSkillsCatalog } from "./Skills.js";

const MAX_ENTRIES = 64;
const fileCache = new Map();
const skillsCache = new Map();

function remember(cache, key, value) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
}

function statIdentity(stat) {
  return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");
}

async function fileIdentity(file) {
  const stat = await fs.stat(file);
  return statIdentity(stat);
}

// Cache only immutable runtime metadata. Conversation history deliberately keeps
// using FileUtils.readFile so messages and execution state are never resident in
// this process-level cache.
export async function readRuntimeMetadata(file) {
  if (!file) return { value: undefined, cacheHit: false };

  const resolved = path.resolve(file);
  let identity;
  try {
    identity = await fileIdentity(resolved);
  } catch (error) {
    if (error?.code === "ENOENT") return { value: undefined, cacheHit: false };
    throw error;
  }

  const cached = fileCache.get(resolved);
  if (cached?.identity === identity) {
    return { value: cached.value, cacheHit: true };
  }

  const value = await fs.readFile(resolved, "utf8");
  remember(fileCache, resolved, { identity, value });
  return { value, cacheHit: false };
}

async function skillsIdentity(skillsDir) {
  const resolved = path.resolve(skillsDir);
  const entries = await fs.readdir(resolved, { withFileTypes: true });
  const parts = [resolved];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(resolved, entry.name, "SKILL.md");
    try {
      parts.push(`${entry.name}:${await fileIdentity(skillFile)}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return parts.join("|");
}

export async function loadSkillsCatalogMetadata(skillsDir) {
  if (!skillsDir) return { value: null, cacheHit: false };
  const resolved = path.resolve(skillsDir);
  let identity;
  try {
    identity = await skillsIdentity(resolved);
  } catch (error) {
    if (error?.code === "ENOENT") return { value: null, cacheHit: false };
    throw error;
  }

  const cached = skillsCache.get(resolved);
  if (cached?.identity === identity) {
    return { value: cached.value, cacheHit: true };
  }

  const value = loadSkillsCatalog(resolved);
  remember(skillsCache, resolved, { identity, value });
  return { value, cacheHit: false };
}

export function clearRuntimeMetadataCache() {
  fileCache.clear();
  skillsCache.clear();
}
