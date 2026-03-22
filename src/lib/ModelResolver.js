export function resolveModel(modelOrName, registry = {}) {
  if (!modelOrName) return null;
  if (typeof modelOrName !== "string") return modelOrName;

  const entry = registry[modelOrName];
  if (!entry) return null;
  return { type: entry.type, config: entry.config };
}

export function resolveFromConfig(config, useName) {
  const models = config.models || {};

  if (useName) {
    const resolved = resolveModel(useName, models);
    if (resolved) return resolved;
  }

  return config.model || {};
}
