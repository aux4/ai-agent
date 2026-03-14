import { readFileSync } from "fs";
import { summarizeMessages } from "../../lib/Compaction.js";
import "colors";

export async function summarizeExecutor(params) {
  const { historyFile, model } = params;

  if (!historyFile) {
    console.error("Error: No history file specified".red);
    process.exit(1);
  }

  if (!model || !model.type) {
    console.error("Error: Model configuration is required for summarization (e.g., --model '{\"type\":\"openai\",\"config\":{\"model\":\"gpt-4o-mini\"}}')".red);
    process.exit(1);
  }

  try {
    const historyContent = readFileSync(historyFile, "utf8");
    const messages = JSON.parse(historyContent);

    if (!Array.isArray(messages)) {
      console.error("Error: Invalid history file format - expected an array".red);
      process.exit(1);
    }

    console.error(`Summarizing ${messages.length} messages...`);

    const summary = await summarizeMessages(messages, model);
    console.log(summary);
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error(`Error: History file '${historyFile}' not found`.red);
    } else if (error instanceof SyntaxError) {
      console.error(`Error: Invalid JSON in history file '${historyFile}'`.red);
    } else {
      console.error(`Error summarizing history: ${error.message}`.red);
    }
    process.exit(1);
  }
}
