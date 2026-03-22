import { readFileSync, writeFileSync } from "fs";
import { compactMessages } from "../../lib/Compaction.js";
import { resolveFromConfig } from "../../lib/ModelResolver.js";
import "colors";

export async function compactExecutor(params) {
  const { historyFile, keepLastMessages } = params;
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
    console.error("Error: Model configuration is required for compaction (e.g., --model '{\"type\":\"openai\",\"config\":{\"model\":\"gpt-4o-mini\"}}')".red);
    process.exit(1);
  }

  try {
    const historyContent = readFileSync(historyFile, "utf8");
    const messages = JSON.parse(historyContent);

    if (!Array.isArray(messages)) {
      console.error("Error: Invalid history file format - expected an array".red);
      process.exit(1);
    }

    const originalCount = messages.length;
    console.error(`Compacting ${originalCount} messages...`);

    const compacted = await compactMessages(messages, model, { keepLastMessages });

    const compactedCount = compacted.length;
    writeFileSync(historyFile, JSON.stringify(compacted));

    console.error(`Compacted: ${originalCount} → ${compactedCount} messages`);

    const summaryMessage = compacted.find(m => m.compacted);
    if (summaryMessage) {
      console.log(summaryMessage.content);
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error(`Error: History file '${historyFile}' not found`.red);
    } else if (error instanceof SyntaxError) {
      console.error(`Error: Invalid JSON in history file '${historyFile}'`.red);
    } else {
      console.error(`Error compacting history: ${error.message}`.red);
    }
    process.exit(1);
  }
}
