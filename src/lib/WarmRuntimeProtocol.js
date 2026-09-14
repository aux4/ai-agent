import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const WARM_RUNTIME_PROTOCOL = 1;
export const MAX_FRAME_BYTES = 64 * 1024 * 1024;

export function runtimeIdentity(runtimeFile) {
  const resolved = fs.realpathSync(runtimeFile);
  const stat = fs.statSync(resolved);
  return crypto.createHash("sha256")
    .update(`${WARM_RUNTIME_PROTOCOL}:${resolved}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`)
    .digest("hex")
    .slice(0, 16);
}

export function runtimeSocketPath(identity) {
  const uid = typeof process.getuid === "function" ? process.getuid() : "user";
  return path.join("/tmp", `aux4-ai-${uid}-${identity}.sock`);
}

export function encodeFrame(value) {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  if (payload.length > MAX_FRAME_BYTES) throw new Error("Warm runtime frame is too large");
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export function frameReader(onFrame, onError) {
  let buffer = Buffer.alloc(0);
  let expected = null;
  return chunk => {
    try {
      buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
      while (true) {
        if (expected === null) {
          if (buffer.length < 4) return;
          expected = buffer.readUInt32BE(0);
          buffer = buffer.subarray(4);
          if (expected > MAX_FRAME_BYTES) throw new Error("Warm runtime frame is too large");
        }
        if (buffer.length < expected) return;
        const payload = buffer.subarray(0, expected);
        buffer = buffer.subarray(expected);
        expected = null;
        onFrame(JSON.parse(payload.toString("utf8")));
      }
    } catch (error) {
      onError(error);
    }
  };
}

export function isSensitiveEnvironmentName(name) {
  return name === "AUX4_ACCESS_TOKEN"
    || /(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|CREDENTIAL|AUTHORIZATION)/i.test(name);
}

export function sanitizedEnvironment(environment = process.env) {
  return Object.fromEntries(
    Object.entries(environment)
      .filter(([name, value]) => !isSensitiveEnvironmentName(name) && value !== undefined)
      .map(([name, value]) => [name, String(value)])
  );
}

export function replaceEnvironment(environment) {
  for (const name of Object.keys(process.env)) delete process.env[name];
  for (const [name, value] of Object.entries(environment || {})) {
    if (value !== undefined && value !== null) process.env[name] = String(value);
  }
}
