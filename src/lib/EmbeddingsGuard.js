import fs from "fs";
import path from "path";
import crypto from "crypto";

// Reserved key inside ids.json (sibling to the per-document chunk entries) that records which
// embeddings configuration built this store. Additive and backward compatible: existing stores
// simply don't have this key, and are treated as having been built with the legacy default
// ("openai", the only type that existed before this guard was added).
const META_KEY = "__embeddingsMeta__";
const LEGACY_TYPE = "openai";

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

export function computeFingerprint(type, config) {
  const normalized = stableStringify({ type, config: config || {} });
  return crypto.createHash("md5").update(normalized).digest("hex");
}

export function buildEmbeddingsMeta(type, config) {
  return {
    type,
    dimension: (config && config.dimension) || null,
    fingerprint: computeFingerprint(type, config)
  };
}

function idsFilePath(storageDir) {
  return path.join(storageDir, "ids.json");
}

export function readIdsMap(storageDir) {
  const file = idsFilePath(storageDir);
  if (!fs.existsSync(file)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function hasIndexedDocuments(idsMap) {
  return Object.keys(idsMap).some(key => key !== META_KEY);
}

/**
 * Verifies that `type`/`config` are compatible with whatever embeddings configuration the store
 * at `storageDir` was already built with. Does nothing (and returns the current meta) if the
 * store is empty/new. Throws a clear, actionable error on mismatch. Never throws for a legacy
 * store (no recorded meta) being read with the legacy "openai" type -- only on a genuine change.
 */
export function ensureCompatibleEmbeddings(storageDir, type, config) {
  const idsMap = readIdsMap(storageDir);
  const currentMeta = buildEmbeddingsMeta(type, config);

  if (!hasIndexedDocuments(idsMap)) {
    return currentMeta;
  }

  const existingMeta = idsMap[META_KEY] || buildEmbeddingsMeta(LEGACY_TYPE, {});

  if (existingMeta.fingerprint !== currentMeta.fingerprint) {
    throw new Error(
      `Embeddings mismatch: the store at '${storageDir}' was indexed with embeddings type ` +
      `'${existingMeta.type}'${existingMeta.dimension ? ` (dimension ${existingMeta.dimension})` : ""}, ` +
      `but the current configuration uses type '${currentMeta.type}'${currentMeta.dimension ? ` (dimension ${currentMeta.dimension})` : ""}. ` +
      `Mixing embeddings from different models/configs in the same store produces incompatible vectors. ` +
      `Run 'aux4 ai agent forget --storage ${storageDir}' to clear the store, then re-run ` +
      `'aux4 ai agent learn --storage ${storageDir}' with the new embeddings configuration.`
    );
  }

  return currentMeta;
}

export function writeEmbeddingsMeta(storageDir, meta) {
  const file = idsFilePath(storageDir);
  const idsMap = readIdsMap(storageDir);
  idsMap[META_KEY] = meta;
  fs.mkdirSync(storageDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(idsMap), "utf8");
}
