import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RunnableLambda } from "@langchain/core/runnables";
import { AIMessage } from "@langchain/core/messages";
import Prompt from "../src/lib/Prompt.js";

function fakePrompt(responses, historyFile) {
  const prompt = new Prompt({ type: "openai", config: { model: "local-test", apiKey: "local-test" } });
  let calls = 0;
  prompt.model = RunnableLambda.from(async () => {
    assert.ok(calls < responses.length, 'unexpected extra model call');
    return responses[calls++];
  });
  prompt.messages = [{ role: "user", content: "Read the records and finish the request." }];
  prompt.historyFile = historyFile;
  prompt.tools = { lookup: { invoke: async () => '{"id":"r7"}' } };
  return { prompt, calls: () => calls };
}
const empty = () => new AIMessage({ content: "", response_metadata: { finish_reason: "stop", tokenUsage: { completionTokens: 1 } } });
const lookup = id => new AIMessage({ content: "", tool_calls: [{ name: "lookup", args: {}, id, type: "tool_call" }] });

test("empty replies separated by tool calls do not exhaust a consecutive-empty limit", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "empty-progress-"));
  try {
    const file = path.join(dir, "history.json");
    const { prompt, calls } = fakePrompt([empty(), lookup('one'), empty(), lookup('two'), empty(), new AIMessage('done')], file);
    assert.equal(await prompt.execute(), 'done');
    assert.equal(calls(), 6);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(data.modelDiagnostics.length, 3);
    assert.equal(data.messages.filter(message => message.role === 'tool').length, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("three consecutive empty replies stop and retain diagnostic evidence", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "empty-stop-"));
  try {
    const file = path.join(dir, "history.json");
    const malformed = new AIMessage({ content: '', invalid_tool_calls: [{ name: 'lookup', args: '{', error: 'Invalid JSON', type: 'invalid_tool_call' }] });
    const { prompt, calls } = fakePrompt([empty(), malformed, empty()], file);
    assert.match(await prompt.execute(), /empty response three times/);
    assert.equal(calls(), 3);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(data.modelDiagnostics.length, 3);
    assert.equal(data.modelDiagnostics[0].finishReason, 'stop');
    assert.equal(data.modelDiagnostics[1].invalidToolCalls[0].args, '{');
    assert.equal(data.messages.some(message => JSON.stringify(message).includes('invalidToolCalls')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});


const protocolFailure = id => new AIMessage({ content: '', tool_calls: [{
  name: '__tool_protocol_error__', id, type: 'tool_call',
  args: { error: 'No function provided.', raw: 'call:cloud records list{query:active}' }
}] });

test("protocol errors give model-visible repair feedback without executing an inferred command", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protocol-repair-'));
  try {
    const file = path.join(dir, 'history.json');
    const { prompt, calls } = fakePrompt([protocolFailure('bad'), lookup('fixed'), new AIMessage('done')], file);
    let invalidInvocations = 0;
    prompt.tools.__tool_protocol_error__ = { invoke: async () => { invalidInvocations++; } };
    assert.equal(await prompt.execute(), 'done');
    assert.equal(calls(), 3);
    assert.equal(invalidInvocations, 0);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const feedback = data.messages.find(message => message.role === 'tool').content;
    assert.match(feedback, /No action was run/);
    assert.match(feedback, /Available tools: lookup/);
    assert.match(feedback, /call:cloud records list/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("unrepairable tool protocol stops after three rejected requests", async () => {
  const { prompt, calls } = fakePrompt([protocolFailure('one'), protocolFailure('two'), protocolFailure('three')]);
  assert.match(await prompt.execute(), /Stopped:/);
  assert.equal(calls(), 3);
  assert.match(prompt.messages.findLast(message => message.role === 'tool').content, /Aborting:/);
});
