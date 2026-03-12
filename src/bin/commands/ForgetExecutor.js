import fs from "fs";
import path from "path";
import LlmStore from "../../lib/LlmStore.js";
import { getEmbeddings } from "../../lib/Embeddings.js";

export async function forgetExecutor(params) {
  const storage = params.storage;
  const doc = params.doc;
  const embeddingsConfig = params.embeddings;

  if (!doc) {
    // Delete all store files
    const files = ["docstore.json", "faiss.index", "ids.json"];
    for (const file of files) {
      const filePath = path.join(storage, file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    return;
  }

  const type = embeddingsConfig ? embeddingsConfig.type || "openai" : "openai";
  const config = embeddingsConfig ? embeddingsConfig.config : {};
  const Embeddings = getEmbeddings(type);
  const embeddings = new Embeddings(config);

  const store = new LlmStore(storage, embeddings);
  await store.load();

  if (!store.store) {
    return;
  }

  const changed = await store.forgetDocument(doc);
  if (changed) {
    await store.save();
  }
}
