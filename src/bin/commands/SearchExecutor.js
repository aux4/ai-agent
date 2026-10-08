import LlmStore from "../../lib/LlmStore.js";
import { getEmbeddings, DEFAULT_EMBEDDINGS_TYPE } from "../../lib/Embeddings.js";
import { ensureCompatibleEmbeddings } from "../../lib/EmbeddingsGuard.js";

export async function searchExecutor(params) {
  const storage = params.storage;
  const query = params.query;
  const format = params.format;
  const limit = params.limit;
  const source = params.source;
  const embeddingsConfig = params.embeddings;

  const type = embeddingsConfig ? embeddingsConfig.type || DEFAULT_EMBEDDINGS_TYPE : DEFAULT_EMBEDDINGS_TYPE;
  const config = embeddingsConfig ? embeddingsConfig.config || {} : {};
  ensureCompatibleEmbeddings(storage, type, config);
  const Embeddings = getEmbeddings(type);
  const embeddings = new Embeddings(config);

  const store = new LlmStore(storage, embeddings);
  await store.load();

  const searchOptions = {
    limit: limit,
    source: source
  };

  try {
    const result = await store.search(query, searchOptions);

    if (format === "json") {
      console.log(JSON.stringify(result));
    } else {
      const text = result.map(item => item.pageContent).join("\n\n");
      console.log(text);
    }
  } catch (error) {
    if (error.message.includes("No documents have been indexed yet")) {
      console.error(error.message);
      process.exit(1);
    } else {
      throw error;
    }
  }
}
