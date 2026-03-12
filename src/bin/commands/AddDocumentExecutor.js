import fs from "fs";
import path from "path";
import LlmStore from "../../lib/LlmStore.js";
import { getEmbeddings } from "../../lib/Embeddings.js";

const SUPPORTED_EXTENSIONS = new Set([".md", ".txt", ".pdf", ".json", ".csv", ".docx", ".pptx"]);

function collectFiles(dirPath) {
  const files = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;

    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }

  return files;
}

export async function addDocumentExecutor(params) {
  const storage = params.storage;
  const doc = params.doc;
  const docType = params.type;
  const embeddingsConfig = params.embeddings;

  const type = embeddingsConfig ? embeddingsConfig.type || "openai" : "openai";
  const config = embeddingsConfig ? embeddingsConfig.config : {};
  const Embeddings = getEmbeddings(type);
  const embeddings = new Embeddings(config);

  const store = new LlmStore(storage, embeddings);
  await store.load();

  const resolvedDoc = path.resolve(doc);
  const stat = fs.statSync(resolvedDoc);

  if (stat.isDirectory()) {
    const files = collectFiles(resolvedDoc);
    if (files.length === 0) {
      console.log(`No supported files found in ${doc}`);
      return;
    }
    for (const file of files) {
      await store.addDocument(path.resolve(file), docType);
    }
  } else {
    await store.addDocument(resolvedDoc, docType);
  }

  await store.save();
}
