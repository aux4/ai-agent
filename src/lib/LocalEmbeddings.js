import { Embeddings } from "@langchain/core/embeddings";
import { spawn } from "child_process";

// Overridable for tests: a space-separated command to run instead of "aux4 embedding embed".
// The replacement must read a JSON array from stdin and print a JSON array of vectors to stdout,
// exactly like the real command — this lets tests exercise LocalEmbeddings without network access
// or the aux4/embedding package installed.
const DEFAULT_COMMAND = "aux4 embedding embed";

/**
 * Embeddings implementation that shells out to `aux4 embedding embed` (aux4/embedding package),
 * which runs Google's EmbeddingGemma 2 model locally on CPU via @huggingface/transformers.
 *
 * Configuration:
 * - modalities: "text" or "full" (default: "text")
 * - dimension: 768, 512, 256, or 128 (default: 768)
 * - dtype: fp32, fp16, q8, q4, q4f16 (default: "q8")
 * - cacheDir: model cache directory (default: aux4/embedding's own default)
 * - device: inference device (default: "cpu")
 * - batchSize: number of items sent per `aux4 embedding embed` call (default: 64) — the model
 *   takes ~0.6s to warm-load per call, so batching many chunks into one call matters for
 *   anything beyond a single document.
 */
export class LocalEmbeddings extends Embeddings {
  constructor(fields = {}) {
    super(fields);

    this.modalities = fields.modalities || "text";
    this.dimension = fields.dimension || 768;
    this.dtype = fields.dtype || "q8";
    this.cacheDir = fields.cacheDir;
    this.device = fields.device || "cpu";
    this.batchSize = fields.batchSize || 64;

    const commandOverride = process.env.AUX4_LOCAL_EMBEDDINGS_COMMAND || DEFAULT_COMMAND;
    const parts = commandOverride.split(" ").filter(Boolean);
    this.command = parts[0];
    this.commandArgs = parts.slice(1);
  }

  async embedDocuments(texts) {
    return this._embedBatched(texts, "document");
  }

  async embedQuery(text) {
    const [embedding] = await this._embedBatched([text], "query");
    return embedding;
  }

  async _embedBatched(texts, task) {
    const batches = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      batches.push(texts.slice(i, i + this.batchSize));
    }

    const results = [];
    for (const batch of batches) {
      const vectors = await this._embed(batch, task);
      results.push(...vectors);
    }

    return results;
  }

  _embed(items, task) {
    const args = [
      ...this.commandArgs,
      "--modalities", this.modalities,
      "--task", task,
      "--dimension", String(this.dimension),
      "--dtype", this.dtype,
      "--device", this.device
    ];

    if (this.cacheDir) {
      args.push("--cacheDir", this.cacheDir);
    }

    return new Promise((resolve, reject) => {
      const child = spawn(this.command, args, { stdio: ["pipe", "pipe", "pipe"] });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", chunk => { stdout += chunk; });
      child.stderr.on("data", chunk => { stderr += chunk; });

      child.on("error", error => {
        reject(new Error(`Failed to run local embeddings command '${this.command}': ${error.message}`));
      });

      child.on("close", code => {
        if (code !== 0) {
          reject(new Error(`Local embeddings command exited with code ${code}: ${stderr.trim() || "no error output"}`));
          return;
        }

        try {
          const vectors = JSON.parse(stdout);
          resolve(vectors);
        } catch (error) {
          reject(new Error(`Failed to parse local embeddings output: ${error.message}`));
        }
      });

      child.stdin.write(JSON.stringify(items));
      child.stdin.end();
    });
  }
}
