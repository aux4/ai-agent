import Prompt, { PromptError } from "../../lib/Prompt.js";
import { readFile, asJson } from "../../lib/util/FileUtils.js";
import { readStdIn } from "../../lib/util/Input.js";

export async function askExecutor(params) {
  try {
    const baseInstructions = params.baseInstructions;
    const instructions = params.instructions;
    const model = params.model;
    const question = params.question;
    const role = params.role;
    const history = params.history;
    const outputSchema = params.outputSchema;
    const context = params.context;
    const storage = params.storage;
    const stream = params.stream;
    const autoCompact = params.autoCompact === true || params.autoCompact === "true";
    const compaction = autoCompact ? params.compaction : null;
    const bio = params.bio;

    let contextContent;
    if (context === true || context === "true") {
      contextContent = await readStdIn();
    }

    let message = question;
    if (contextContent) {
      message = `---\n${contextContent}\n---\n${question}`;
    }

    // Create tools configuration if storage is provided
    const toolsConfig = storage ? { storage } : {};

    const prompt = new Prompt(model, toolsConfig, { compaction });
    await prompt.init();

    if (bio && typeof bio === "object" && Object.keys(bio).length > 0) {
      const bioParts = [];
      if (bio.name) bioParts.push(`**Name:** ${bio.name}`);
      if (bio.role) bioParts.push(`**Role:** ${bio.role}`);
      if (bio.description) bioParts.push(`**Description:** ${bio.description}`);
      if (bioParts.length > 0) {
        await prompt.instructions(`# Agent Identity\n\n${bioParts.join("\n")}`);
      }
    }

    if (baseInstructions) {
      await prompt.instructions(await readFile(baseInstructions), params);
    }
    if (instructions) {
      await prompt.instructions(await readFile(instructions), params);
    }
    await prompt.instructions("If you need to ask the user a question or need clarification, use the askUser tool. Always call askUser alone, never in parallel with other tools.");

    await prompt.history(history);

    if (stream === true || stream === "true") {
      prompt.setStreaming(true);
      prompt.onToken(token => process.stdout.write(token));
      prompt.onMessage(answer => {
        process.stdout.write("\n");
      });
    } else {
      prompt.onMessage(answer => {
        console.log(answer.trim());
      });
    }

    prompt.setOutputSchema(await readFile(outputSchema).then(asJson()));

    await prompt.message(message, params, role);

    prompt.close();
  } catch (error) {
    if (error instanceof PromptError) {
      console.error("Prompt error:", error.message);
    } else {
      console.error("Error in askExecutor:");
      console.error("Message:", error.message);
      console.error("Stack trace:");
      console.error(error.stack);
    }
    throw error;
  }
}
