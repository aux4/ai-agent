import { readFileSync } from "fs";
import { rememberMessages } from "../../lib/Compaction.js";
import { resolveFromConfig } from "../../lib/ModelResolver.js";
import "colors";

export async function rememberExecutor(params) {
  const { historyFile } = params;
  const model = params.useModel
    ? resolveFromConfig({ models: params.models, model: params.model }, params.useModel)
    : (params.models && Object.keys(params.models).length > 0
      ? resolveFromConfig({ models: params.models, model: params.model })
      : params.model);

  if (!historyFile) {
    console.error("Error: No history file specified".red);
    process.exit(1);
  }

  if (!model || !model.type) {
    console.error("Error: Model configuration is required (e.g., --model '{\"type\":\"openai\",\"config\":{\"model\":\"gpt-4o-mini\"}}')".red);
    process.exit(1);
  }

  try {
    const historyContent = readFileSync(historyFile, "utf8");
    const messages = JSON.parse(historyContent);

    if (!Array.isArray(messages)) {
      console.error("Error: Invalid history file format - expected an array".red);
      process.exit(1);
    }

    console.error(`Generating memory entry from ${messages.length} messages...`);

    const memory = await rememberMessages(messages, model);
    console.log(memory);
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error(`Error: History file '${historyFile}' not found`.red);
    } else if (error instanceof SyntaxError) {
      console.error(`Error: Invalid JSON in history file '${historyFile}'`.red);
    } else {
      console.error(`Error generating memory: ${error.message}`.red);
    }
    process.exit(1);
  }
}
