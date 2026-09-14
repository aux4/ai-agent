#!/usr/bin/env node

import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
  WARM_RUNTIME_PROTOCOL,
  encodeFrame,
  frameReader,
  runtimeIdentity,
  runtimeSocketPath
} from "../lib/WarmRuntimeProtocol.js";

const CLIENT_CONNECT_TIMEOUT_MS = 10000;
const RETRY_MS = 25;

function emitBootstrapTiming(started, status, attributes) {
  const traceId = process.env.AUX4_TRACE_ID || "";
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(traceId)) return;
  const phaseValue = String(process.env.AUX4_EXECUTION_PHASE || "agent").toLowerCase();
  const phase = /^[a-z][a-z0-9.-]{0,63}$/.test(phaseValue) ? phaseValue : "agent";
  process.stderr.write(`${JSON.stringify({
    type: "aux4.timing",
    traceId,
    phase,
    span: "agent.bootstrap",
    durationMs: Number((Number(process.hrtime.bigint() - started) / 1e6).toFixed(3)),
    status,
    ...attributes
  })}\n`);
}

function connect(socketPath) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

async function connectUntilReady(socketPath, deadline) {
  let lastError;
  while (Date.now() < deadline) {
    try { return await connect(socketPath); } catch (error) { lastError = error; }
    await delay(RETRY_MS);
  }
  throw lastError || new Error("Warm runtime did not become ready");
}

function launch(runtimeFile, socketPath, identity) {
  const child = spawn(process.execPath, [runtimeFile, "--warm-server", socketPath, identity], {
    detached: true,
    env: process.env,
    stdio: "ignore"
  });
  child.unref();
}

function request(socket, value) {
  return new Promise((resolve, reject) => {
    let received = false;
    socket.on("data", frameReader(response => {
      if (received) return;
      received = true;
      resolve(response);
    }, reject));
    socket.once("error", reject);
    socket.once("end", () => {
      if (!received) reject(new Error("Warm runtime closed without a response"));
    });
    socket.end(encodeFrame(value));
  });
}

function directFallback(runtimeFile, args, stdin) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [runtimeFile, ...args], {
      env: process.env,
      stdio: ["pipe", "inherit", "inherit"]
    });
    child.once("exit", code => resolve(Number.isInteger(code) ? code : 1));
    child.once("error", error => {
      process.stderr.write(`${error.message}\n`);
      resolve(1);
    });
    child.stdin.end(stdin);
  });
}

async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

export async function runWarmClient({ runtimeFile, args, stdin, environment = process.env, cwd = process.cwd() }) {
  const identity = runtimeIdentity(runtimeFile);
  const socketPath = runtimeSocketPath(identity);
  const started = process.hrtime.bigint();
  let socket;
  let cacheHit = true;

  try {
    socket = await connect(socketPath);
  } catch {
    cacheHit = false;
    launch(runtimeFile, socketPath, identity);
    try {
      socket = await connectUntilReady(socketPath, Date.now() + CLIENT_CONNECT_TIMEOUT_MS);
    } catch {
      emitBootstrapTiming(started, "error", { cacheHit: false, cold: true });
      return await directFallback(runtimeFile, args, stdin);
    }
  }

  emitBootstrapTiming(started, "ok", { cacheHit, cold: !cacheHit });
  const response = await request(socket, {
    protocol: WARM_RUNTIME_PROTOCOL,
    identity,
    cwd,
    env: environment,
    args,
    stdin
  });
  process.stdout.write(Buffer.from(response.stdout || "", "base64"));
  process.stderr.write(Buffer.from(response.stderr || "", "base64"));
  return Number.isInteger(response.exitCode) ? response.exitCode : 1;
}

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const runtimeFile = path.join(here, "aux4-ai-agent.cjs");
  const stdin = await readInput();
  process.exitCode = await runWarmClient({ runtimeFile, args: process.argv.slice(2), stdin });
}

main();
