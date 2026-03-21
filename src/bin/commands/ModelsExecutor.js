import "colors";

export async function modelsExecutor(params) {
  const { models } = params;

  if (!models || typeof models !== "object" || Object.keys(models).length === 0) {
    console.error("No models registry configured.".yellow);
    return;
  }

  const entries = Object.entries(models);

  for (const [name, entry] of entries) {
    const type = entry.type || "unknown";
    const model = (entry.config && entry.config.model) || "";
    const description = entry.description || "";

    let line = `  ${name.green}  ${type}`;
    if (model) line += `  ${model}`;
    if (description) line += `  ${description.gray}`;

    console.log(line);
  }
}
