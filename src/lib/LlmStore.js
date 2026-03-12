import fs from "fs";
import path from "path";
import crypto from "crypto";
import { FaissStore } from "@langchain/community/vectorstores/faiss";
import { getDocLoader } from "./DocLoaders.js";
import { getDocSplitter } from "./DocSplitters.js";

function computeMd5(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("md5").update(content).digest("hex");
}

function getChunks(entry) {
  if (Array.isArray(entry)) return entry;
  return entry.chunks || [];
}

export default class LlmStore {
  constructor(directory, embeddings) {
    this.directory = directory;
    this.embeddings = embeddings;
  }

  async load() {
    if (!fs.existsSync(this.directory) || !fs.existsSync(`${this.directory}/docstore.json`)) {
      return;
    }
    this.store = await FaissStore.load(this.directory, this.embeddings);
  }

  async addDocument(docPath, type) {
    if (!type) {
      type = docPath.split(".").pop();
    }

    // Ensure directory exists when actually adding documents
    if (!fs.existsSync(this.directory)) {
      fs.mkdirSync(this.directory, { recursive: true });
    }

    const idsMap = await getIdsMap(this.directory);
    const md5 = computeMd5(docPath);

    const existing = idsMap[docPath];
    if (existing) {
      const existingMd5 = Array.isArray(existing) ? null : existing.md5;
      if (existingMd5 && existingMd5 === md5) {
        console.log(`Skipped (unchanged): ${docPath}`);
        return;
      }

      // MD5 differs or old format — delete old chunks and re-embed
      if (this.store) {
        try {
          await this.store.delete({ ids: getChunks(existing) });
        } catch {
        }
      }
      delete idsMap[docPath];
      await saveIdsMap(this.directory, idsMap);
    }

    const Loader = getDocLoader(type);
    const loader = new Loader(docPath);

    let doc;
    try {
      doc = await loader.load();
    } catch (error) {
      throw new Error(`Failed to load document ${docPath}: ${error.message}`);
    }

    if (!doc || doc.length === 0) {
      throw new Error(`No content could be extracted from document: ${docPath}. The file may be empty, corrupted, or in an unsupported format.`);
    }

    doc.forEach(document => {
      document.metadata.source = docPath;
    });

    const splitter = getDocSplitter(type);
    const chunks = await splitter.splitDocuments(doc);

    const chunkIds = [];
    chunks.forEach(chunk => {
      chunk.metadata.source = docPath;
    });

    for (let i = 0; i < chunks.length; i++) {
      chunkIds.push(`${docPath}-${Date.now()}-chunk-${i}`);
    }

    if (chunks.length === 0) {
      throw new Error(`Document was loaded but no text chunks could be created from: ${docPath}. The document may contain only images or unsupported content.`);
    }

    if (!this.store) {
      this.store = await FaissStore.fromDocuments(chunks, this.embeddings, { ids: chunkIds });
    } else {
      await this.store.addDocuments(chunks, { ids: chunkIds });
    }

    idsMap[docPath] = {
      md5,
      chunks: chunkIds,
      indexedAt: new Date().toISOString()
    };

    await saveIdsMap(this.directory, idsMap);
  }

  async forgetDocument(docPath) {
    const idsMap = await getIdsMap(this.directory);
    const resolvedPath = path.resolve(docPath);
    let changed = false;

    for (const key of Object.keys(idsMap)) {
      if (key === resolvedPath || key.startsWith(resolvedPath + "/")) {
        const chunks = getChunks(idsMap[key]);
        if (this.store && chunks.length > 0) {
          try {
            await this.store.delete({ ids: chunks });
          } catch {
          }
        }
        delete idsMap[key];
        changed = true;
      }
    }

    if (changed) {
      await saveIdsMap(this.directory, idsMap);
    }

    return changed;
  }

  async search(query, options = {}) {
    if (!this.store) {
      throw new Error("No documents have been indexed yet. Please use 'aux4 ai agent learn <document>' to add documents to the vector store first.");
    }

    const { limit: rawLimit, source } = options;
    const limit = parseInt(rawLimit) || 1;

    if (source) {

      const docPath = path.resolve(source);
      let searchLimit = limit * 2;

      const idsMap = await getIdsMap(this.directory);
      const entry = idsMap[docPath];
      const ids = entry ? getChunks(entry) : undefined;
      if (ids && ids.length < searchLimit) {
        searchLimit = ids.length;
      }

      const results = await this.store.similaritySearch(query, searchLimit);

      const filteredResults = results.filter(doc =>
        doc.metadata && doc.metadata.source === docPath
      ).slice(0, limit);

      return filteredResults;
    }

    // Suppress FAISS warnings by intercepting console output temporarily
    const originalConsoleWarn = console.warn;
    const originalConsoleLog = console.log;

    // Temporarily suppress console warnings during search
    console.warn = (...args) => {
      const message = args.join(' ');
      if (message.includes('is greater than the number of elements') ||
          message.includes('setting k to')) {
        return; // Suppress this specific warning
      }
      originalConsoleWarn.apply(console, args);
    };

    console.log = (...args) => {
      const message = args.join(' ');
      if (message.includes('is greater than the number of elements') ||
          message.includes('setting k to')) {
        return; // Suppress this specific message
      }
      originalConsoleLog.apply(console, args);
    };

    try {
      const results = await this.store.similaritySearch(query, limit);
      return results;
    } finally {
      // Restore original console methods
      console.warn = originalConsoleWarn;
      console.log = originalConsoleLog;
    }
  }

  async save() {
    if (this.store) {
      // Ensure directory exists when saving
      if (!fs.existsSync(this.directory)) {
        fs.mkdirSync(this.directory, { recursive: true });
      }
      await this.store.save(this.directory);
    }
  }

  asRetriever() {
    return this.store.asRetriever();
  }
}

async function getIdsMap(directory) {
  const idsFilePath = `${directory}/ids.json`;
  let idsMap = {};

  if (fs.existsSync(directory) && fs.existsSync(idsFilePath)) {
    try {
      idsMap = JSON.parse(fs.readFileSync(idsFilePath, "utf8"));
    } catch {
      idsMap = {};
    }
  }

  return idsMap;
}

async function saveIdsMap(directory, idsMap) {
  const idsFilePath = `${directory}/ids.json`;

  try {
    // Ensure directory exists when saving
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
    fs.writeFileSync(idsFilePath, JSON.stringify(idsMap), "utf8");
  } catch (e) {
    console.error("Error saving ids:", `${directory}/.ids.json`, e.message);
  }
}
