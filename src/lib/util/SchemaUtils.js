import { z } from "zod";

function buildZodField(fieldDef) {
  const desc = fieldDef.description || "";

  switch (fieldDef.type) {
    case "string":
      return z.string().describe(desc);
    case "number":
      return z.number().describe(desc);
    case "boolean":
      return z.boolean().describe(desc);
    case "array":
      return z.array(buildZodField({ type: fieldDef.items })).describe(desc);
    case "enum":
      return z.enum(fieldDef.values).describe(desc);
    default:
      throw new Error(`Unsupported schema type: ${fieldDef.type}`);
  }
}

function buildZodSchema(jsonSchema) {
  const shape = {};
  for (const [key, fieldDef] of Object.entries(jsonSchema)) {
    shape[key] = buildZodField(fieldDef);
  }
  return z.object(shape);
}

export { buildZodSchema };
