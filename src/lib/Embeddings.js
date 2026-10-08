import { BedrockEmbeddings } from "@langchain/aws";
import { CohereEmbeddings } from "@langchain/cohere";
import { VertexAIEmbeddings } from "@langchain/google-vertexai";
import { MistralAIEmbeddings } from "@langchain/mistralai";
import { OllamaEmbeddings } from "@langchain/ollama";
import { OpenAIEmbeddings } from "@langchain/openai";
import { DatabricksEmbeddings } from "./DatabricksEmbeddings.js";
import { LocalEmbeddings } from "./LocalEmbeddings.js";

// The single source of truth for which embeddings type is used when none is configured.
// "local" runs fully offline (aux4/embedding, EmbeddingGemma 2 on CPU) -- no API key, no network.
export const DEFAULT_EMBEDDINGS_TYPE = "local";

const EMBEDDINGS = {
  local: LocalEmbeddings,
  openai: OpenAIEmbeddings,
  bedrock: BedrockEmbeddings,
  cohere: CohereEmbeddings,
  databricks: DatabricksEmbeddings,
  mistral: MistralAIEmbeddings,
  ollama: OllamaEmbeddings,
  vertex: VertexAIEmbeddings
};

export function getEmbeddings(type) {
  const embeddings = EMBEDDINGS[type];

  if (!embeddings) {
    throw new Error(`Unknown embeddings type: ${type}`);
  }

  return embeddings;
}
