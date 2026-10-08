import fs from "fs";
import path from "path";
import LlmStore from "../../lib/LlmStore.js";
import { getEmbeddings, DEFAULT_EMBEDDINGS_TYPE } from "../../lib/Embeddings.js";
import { ensureCompatibleEmbeddings } from "../../lib/EmbeddingsGuard.js";

export async function forgetExecutor(params) {
  const storage = params.storage;
  const doc = params.doc;
  const embeddingsConfig = params.embeddings;

  if (!doc) {
    // Delete all store files (including the embeddings meta embedded in ids.json) --
    // a full clear doesn't need embeddings compatibility, since nothing is kept.
    const files = ["docstore.json", "faiss.index", "ids.json"];
    for (const file of files) {
      const filePath = path.join(storage, file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    return;
  }

  const type = embeddingsConfig ? embeddingsConfig.type || DEFAULT_EMBEDDINGS_TYPE : DEFAULT_EMBEDDINGS_TYPE;
  const config = embeddingsConfig ? embeddingsConfig.config || {} : {};
  ensureCompatibleEmbeddings(storage, type, config);
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
