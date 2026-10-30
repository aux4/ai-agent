import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executeAux4CliTool, readOutputFile } from "../src/lib/Tools.js";

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "output-truncation-test-"));
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  const aux4 = path.join(bin, "aux4");
  fs.writeFileSync(aux4, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "emit-file") process.stdout.write(fs.readFileSync(args[1]));
`);
  fs.chmodSync(aux4, 0o755);
  return { dir, bin };
}

test("large command output keeps both its beginning and end", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "output-truncation-test-"));
  const file = path.join(dir, "output.txt");
  fs.writeFileSync(file, `START status=needs-input ${"x".repeat(500)} confirmation-contract ${"y".repeat(500)} END diagnostic`);

  const output = readOutputFile(file, 120);
  assert.match(output, /^START status=needs-input/);
  assert.match(output, /\[\.\.\.truncated\.\.\.\]/);
  assert.match(output, /END diagnostic$/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("output below the configured limit is returned byte-for-byte unchanged", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "output-truncation-test-"));
  const file = path.join(dir, "small.json");
  const raw = '{\n  "value": "keep  spacing"\n}\n';
  fs.writeFileSync(file, raw);
  assert.equal(readOutputFile(file, 10000), raw);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("public executeAux4 output compacts complete JSON losslessly before clipping", async t => {
  const { dir, bin } = fixture();
  const priorPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${priorPath || ""}`;
  t.after(() => {
    process.env.PATH = priorPath;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const input = path.join(dir, "result.json");
  const raw = `{
${" \t\r\n".repeat(3000)}
  "largeId": 900719925474099312345678901,
  "overflow": 1e400,
  "text": "keep   spacing, escaped quote \\" and backslash \\\\; unicode \\u263A; newline \\n",
  "timing": { "wallMs": 21, "jeVLatency": 4 },
  "items": [ { "id": "a" }, { "id": "b" } ]
}`;
  fs.writeFileSync(input, raw);

  const output = await executeAux4CliTool.invoke({ command: `emit-file ${input}` });
  assert.ok(Buffer.byteLength(output, "utf-8") <= 10000);
  assert.doesNotMatch(output, /Output truncated|Full output was written to/);
  assert.deepEqual(JSON.parse(output), JSON.parse(raw));
  assert.equal(output, String.raw`{"largeId":900719925474099312345678901,"overflow":1e400,"text":"keep   spacing, escaped quote \" and backslash \\; unicode \u263A; newline \n","timing":{"wallMs":21,"jeVLatency":4},"items":[{"id":"a"},{"id":"b"}]}`);
  assert.match(output, /"largeId":900719925474099312345678901/);
  assert.match(output, /"overflow":1e400/);
  assert.match(output, /"text":"keep   spacing, escaped quote \\" and backslash \\\\; unicode \\u263A; newline \\n"/);
  assert.match(output, /"timing":\{"wallMs":21,"jeVLatency":4\}/);

  const secondRaw = raw.replace('"wallMs": 21', '"wallMs": 89');
  const secondInput = path.join(dir, "result-with-new-timing.json");
  fs.writeFileSync(secondInput, secondRaw);
  const secondOutput = await executeAux4CliTool.invoke({ command: `emit-file ${secondInput}` });
  const firstPayload = JSON.parse(output);
  const secondPayload = JSON.parse(secondOutput);
  firstPayload.timing = secondPayload.timing;
  assert.deepEqual(secondPayload, firstPayload, "timing-only changes leave every evidence value intact and parseable");
});

test("invalid, over-cap, and still-oversized JSON retain the existing clipped fallback", async t => {
  const { dir, bin } = fixture();
  const priorPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${priorPath || ""}`;
  t.after(() => {
    process.env.PATH = priorPath;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const invalidFile = path.join(dir, "invalid.json");
  const invalid = `{"prefix":"visible", ${" ".repeat(10020)}"broken":}`;
  fs.writeFileSync(invalidFile, invalid);
  const invalidOutput = readOutputFile(invalidFile, 10000);
  assert.match(invalidOutput, /^\{"prefix":"visible"/);
  assert.match(invalidOutput, /\[\.\.\.truncated\.\.\.\]/);

  const truncatedFile = path.join(dir, "truncated.json");
  fs.writeFileSync(truncatedFile, `{"prefix":"visible","unfinished":${" ".repeat(10020)}`);
  assert.match(readOutputFile(truncatedFile, 10000), /\[\.\.\.truncated\.\.\.\]/);

  const invalidUtf8File = path.join(dir, "invalid-utf8.json");
  fs.writeFileSync(invalidUtf8File, Buffer.concat([
    Buffer.from('{"prefix":"visible","value":"'),
    Buffer.from([0xff]),
    Buffer.from(`"${" ".repeat(10020)}}`)
  ]));
  assert.match(readOutputFile(invalidUtf8File, 10000), /\[\.\.\.truncated\.\.\.\]/);

  const oversizedCompactFile = path.join(dir, "oversized-compact.json");
  const oversizedCompact = JSON.stringify({ value: "東京".repeat(3000) }, null, 2);
  assert.ok(oversizedCompact.length < 10000, "the fixture fits by character count");
  assert.ok(Buffer.byteLength(oversizedCompact, "utf-8") > 10000, "the fixture exceeds the byte limit");
  fs.writeFileSync(oversizedCompactFile, oversizedCompact);
  assert.match(readOutputFile(oversizedCompactFile, 10000), /\[\.\.\.truncated\.\.\.\]/);

  const overCapFile = path.join(dir, "over-cap.json");
  fs.writeFileSync(overCapFile, `{${" \t\n".repeat(100000)}"value":1}`);
  assert.ok(fs.statSync(overCapFile).size > 256 * 1024);
  assert.match(readOutputFile(overCapFile, 10000), /\[\.\.\.truncated\.\.\.\]/);

  const publicResult = await executeAux4CliTool.invoke({ command: `emit-file ${oversizedCompactFile}` });
  assert.match(publicResult, /\[\.\.\.truncated\.\.\.\]/);
  const fullOutputPath = publicResult.match(/Full output was written to ([^\]]+)/)?.[1];
  assert.ok(fullOutputPath && fs.existsSync(fullOutputPath), "the existing full-output recovery path remains available");
  fs.rmSync(fullOutputPath, { force: true });
});
