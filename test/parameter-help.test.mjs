import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parameterHelpArgs, parameterErrorHelp } from "../src/lib/ParameterHelp.js";
import { executeAux4CliTool, createExecuteAux4Tool } from "../src/lib/Tools.js";

test("CLI parser errors request only the original command's help", () => {
  assert.deepEqual(parameterHelpArgs(['aux4', 'records', 'get', '--id', 'r7'], 'Unknown parameter --id'), ['records', 'get', '--help']);
  assert.deepEqual(parameterHelpArgs(['records', 'create'], 'Missing required parameter --name'), ['records', 'create', '--help']);
  assert.equal(parameterHelpArgs(['records', 'get', '--help'], 'Unknown parameter --help'), null);
  for (const error of ['Permission denied', 'HTTP 500 unavailable', 'Invalid recipient', 'success'])
    assert.equal(parameterHelpArgs(['records', 'create', '--name', 'x'], error), null);
});

test("diagnostic help is bounded, optional, and cannot replace the original failure", () => {
  let calls = 0;
  const help = parameterErrorHelp(['records', 'get', '--id', 'r7'], 'Unknown parameter --id', '/work', (bin, args, options) => {
    calls++;
    assert.equal(bin, 'aux4');
    assert.deepEqual(args, ['records', 'get', '--help']);
    assert.equal(options.cwd, '/work');
    assert.equal(options.timeout, 3000);
    return { status: 0, stdout: '--recordId <arg>\n' + 'x'.repeat(5000) };
  });
  assert.match(help, /--recordId/);
  assert.ok(help.length < 2900);
  assert.equal(calls, 1);
  assert.equal(parameterErrorHelp(['records'], 'Unknown parameter --id', undefined, () => ({ status: 1 })), '');
});

test("a failed CLI action returns actual help without replaying the action", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parameter-help-'));
  const previous = process.env.PATH;
  const log = path.join(dir, 'calls.jsonl');
  fs.writeFileSync(path.join(dir, 'aux4'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args.at(-1) === '--help') { console.log('get\\n  --recordId <arg>\\n    Identifier to retrieve.'); }
else { console.error('Unknown parameter --id'); process.exitCode = 1; }
`, { mode: 0o755 });
  process.env.PATH = dir + path.delimiter + previous;
  try {
    for (const commandTool of [executeAux4CliTool, createExecuteAux4Tool({ allow: ['*'] })]) {
      const result = String(await commandTool.invoke({ command: 'records get --id r7' }));
      assert.match(result, /Error executing command: Unknown parameter --id/);
      assert.match(result, /--recordId <arg>/);
    }
    const restricted = createExecuteAux4Tool({ allow: ['records get --id *'] });
    const deniedHelp = String(await restricted.invoke({ command: 'records get --id r7' }));
    assert.match(deniedHelp, /Unknown parameter/);
    assert.doesNotMatch(deniedHelp, /Local command parameter reference/);
    assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse), [
      ['records', 'get', '--id', 'r7'], ['records', 'get', '--help'],
      ['records', 'get', '--id', 'r7'], ['records', 'get', '--help'],
      ['records', 'get', '--id', 'r7']
    ]);
  } finally {
    process.env.PATH = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
