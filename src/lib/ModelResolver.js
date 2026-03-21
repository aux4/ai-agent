export function resolveModel(modelOrName, registry = {}) {
  if (!modelOrName) return null;
  if (typeof modelOrName !== "string") return modelOrName;

  const entry = registry[modelOrName];
  if (!entry) {
    throw new Error(`Unknown model "${modelOrName}". Available: ${
      Object.keys(registry).join(", ")
    }`);
  }
  return { type: entry.type, config: entry.config };
}

export function resolveFromConfig(config, useName) {
  const models = config.models || {};

  if (useName) return resolveModel(useName, models);

  return config.model || {};
}
