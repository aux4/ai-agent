#!/usr/bin/env node

process.removeAllListeners("warning");
const originalEmitWarning = process.emitWarning;
process.emitWarning = function(warning, type, code) {
  if (typeof warning === "string" && warning.includes("punycode")) return;
  if (code === "DEP0040") return;
  return originalEmitWarning.apply(process, arguments);
};

import { dispatchCommand, reportCommandError } from "./dispatch.js";
import { serveWarmRuntime } from "./WarmRuntimeServer.js";

process.title = "aux4-agent";

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--warm-server") {
    const socketPath = args[1];
    const identity = args[2];
    if (!socketPath || !identity) {
      console.error("Warm runtime socket and identity are required");
      process.exitCode = 1;
    } else {
      await serveWarmRuntime({ socketPath, identity, dispatch: dispatchCommand, reportError: reportCommandError });
    }
  } else {
    try {
      await dispatchCommand(args);
    } catch (error) {
      reportCommandError(error);
      process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1;
    }
  }
}

main();
