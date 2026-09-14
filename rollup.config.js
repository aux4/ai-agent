import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import rawPlugin from "./rollup-plugin-raw.js";
import preserveShebang from "rollup-plugin-preserve-shebang";
import { builtinModules } from "module";
import alias from "@rollup/plugin-alias";
import path from "path";

const plugins = () => [
  preserveShebang(),
  alias({
    entries: [
      { find: "pkce-challenge", replacement: "./src/lib/util/PkceWrapper.js" }
    ]
  }),
  rawPlugin(),
  nodeResolve({
    preferBuiltins: module => module !== "punycode",
    resolveOnly: module => {
      return !module.includes("faiss-node") &&
             !module.includes(".node") &&
             !module.includes("@napi-rs/canvas") &&
             !module.includes("canvas");
    },
    browser: false,
    exportConditions: ['node']
  }),
  json(),
  commonjs({
    requireReturnsDefault: "auto",
    defaultIsModuleExports: true,
    transformMixedEsModules: true,
    ignoreDynamicRequires: true
  })
];

const external = [...builtinModules, "faiss-node", "word-extractor", "@napi-rs/canvas", "canvas"];

export default [{
  input: "src/bin/executable.js",
  external,
  plugins: plugins(),
  output: {
    file: "package/lib/aux4-ai-agent.cjs",
    format: "cjs",
    inlineDynamicImports: true
  }
}, {
  input: "src/bin/warm-client.js",
  external,
  plugins: plugins(),
  output: {
    file: "package/lib/aux4-ai-agent-client.cjs",
    format: "cjs",
    inlineDynamicImports: true
  }
}];
