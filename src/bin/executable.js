#!/usr/bin/env node

// Suppress punycode deprecation warning before any imports
process.removeAllListeners("warning");
const originalEmitWarning = process.emitWarning;
process.emitWarning = function(warning, type, code) {
  if (typeof warning === "string" && warning.includes("punycode")) {
    return;
  }
  if (code === "DEP0040") {
    return;
  }
  return originalEmitWarning.apply(process, arguments);
};

import { addDocumentExecutor } from "./commands/AddDocumentExecutor.js";
import { searchExecutor } from "./commands/SearchExecutor.js";
import { forgetExecutor } from "./commands/ForgetExecutor.js";
import { askExecutor } from "./commands/AskExecutor.js";
import { imageExecutor } from "./commands/ImageExecutor.js";
import { historyExecutor } from "./commands/HistoryExecutor.js";
import { compactExecutor } from "./commands/CompactExecutor.js";
import { summarizeExecutor } from "./commands/SummarizeExecutor.js";
import { rememberExecutor } from "./commands/RememberExecutor.js";
import { modelsExecutor } from "./commands/ModelsExecutor.js";

process.title = "aux4-agent";

(async () => {
  try {
    const args = process.argv.slice(2);

  try {
    const command = args[0];

    if (!command) {
      console.log("Usage: aux4-agent <command> [options]");
      console.log("Commands: learn, search, forget, ask, image, history, summarize, remember, compact, models");
      process.exit(1);
    }

    if (command === "learn") {
      await addDocumentExecutor({
        storage: args[1],
        doc: args[2],
        type: args[3],
        embeddings: JSON.parse(args[4] || "{}")
      });
    } else if (command === "search") {
      await searchExecutor({
        storage: args[1],
        format: args[2],
        source: args[3],
        limit: parseInt(args[4]),
        query: args[5],
        embeddings: JSON.parse(args[6] || "{}")
      });
    } else if (command === "forget") {
      await forgetExecutor({
        storage: args[1],
        doc: args[2],
        embeddings: JSON.parse(args[3] || "{}")
      });
    } else if (command === "ask") {
      await askExecutor({
        baseInstructions: args[1],
        instructions: args[2],
        role: args[3],
        history: args[4],
        outputSchema: args[5],
        question: args[6],
        image: args[7],
        context: args[8],
        model: JSON.parse(args[9] || "{}"),
        storage: args[10],
        stream: args[11],
        autoCompact: args[12],
        compaction: JSON.parse(args[13] || "{}"),
        bio: JSON.parse(args[14] || "{}"),
        permissions: JSON.parse(args[15] || "{}"),
        models: JSON.parse(args[16] || "{}"),
        useModel: args[17] || ""
      });
    } else if (command === "image") {
      await imageExecutor({
        prompt: args[1],
        image: args[2],
        size: args[3],
        quality: args[4],
        context: args[5],
        model: JSON.parse(args[6] || "{}"),
        quantity: parseInt(args[7] || "1")
      });
    } else if (command === "history") {
      await historyExecutor({
        historyFile: args[1]
      });
    } else if (command === "summarize") {
      await summarizeExecutor({
        historyFile: args[1],
        model: JSON.parse(args[2] || "{}"),
        models: JSON.parse(args[3] || "{}"),
        useModel: args[4] || ""
      });
    } else if (command === "remember") {
      await rememberExecutor({
        historyFile: args[1],
        model: JSON.parse(args[2] || "{}"),
        models: JSON.parse(args[3] || "{}"),
        useModel: args[4] || ""
      });
    } else if (command === "compact") {
      await compactExecutor({
        historyFile: args[1],
        model: JSON.parse(args[2] || "{}"),
        keepLastMessages: parseInt(args[3] || "6"),
        models: JSON.parse(args[4] || "{}"),
        useModel: args[5] || ""
      });
    } else if (command === "models") {
      await modelsExecutor({
        models: JSON.parse(args[1] || "{}")
      });
    } else {
      console.error(`Unknown command: ${command}`.red);
      console.log("Available commands: learn, search, forget, ask, image, history, summarize, remember, compact, models");
      process.exit(1);
    }
  } catch (e) {
    console.error(e.message.red);
    console.error("Stack trace:");
    console.error(e.stack);
    process.exit(1);
  }
  } catch (outerError) {
    console.error("Outer error occurred:");
    console.error("Message:", outerError.message);
    console.error("Stack trace:");
    console.error(outerError.stack);
    process.exit(1);
  }
})();
