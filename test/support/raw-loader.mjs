// Minimal Node ESM loader hook that lets unit tests import src/ modules
// directly (unbundled), even though the source tree is written to be
// compiled by Rollup to a single CJS bundle (the only way it runs in
// production/CI). Two build-time assumptions it stands in for:
//   1. rollup-plugin-raw.js: `import x from "./file.md?raw"` -> the file's
//      raw text (used for tool description markdown in Tools.js).
//   2. Rollup's CJS output format: source written against `__dirname`/
//      `__filename` (CJS globals) compiles fine because Rollup's output IS
//      CJS; under plain Node ESM those identifiers don't exist, so this
//      shims them from `import.meta.url` for any package src file that
//      references them.
// Test-only. Does not change what ships (package/lib/*.cjs, built by Rollup).
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith("?raw")) {
    const resolved = await nextResolve(specifier.slice(0, -"?raw".length), context);
    return { ...resolved, url: `${resolved.url}?raw`, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith("?raw")) {
    const filePath = fileURLToPath(url.slice(0, -"?raw".length));
    const content = fs.readFileSync(filePath, "utf-8");
    return { format: "module", shortCircuit: true, source: `export default ${JSON.stringify(content)};` };
  }

  const result = await nextLoad(url, context);
  const source = typeof result.source === "string" ? result.source : result.source ? result.source.toString("utf-8") : "";
  if (
    result.format === "module" &&
    url.startsWith("file://") &&
    url.includes("/ai-agent-CSEC028/src/") &&
    (source.includes("__dirname") || source.includes("__filename"))
  ) {
    const shim =
      'import { fileURLToPath as __aux4RawLoaderFileURLToPath } from "node:url";\n' +
      'import { dirname as __aux4RawLoaderDirname } from "node:path";\n' +
      "const __filename = __aux4RawLoaderFileURLToPath(import.meta.url);\n" +
      "const __dirname = __aux4RawLoaderDirname(__filename);\n";
    return { ...result, source: shim + source };
  }
  return result;
}
