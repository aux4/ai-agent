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
    const { prompt, calls } = fakePrompt([empty(), empty(), empty()], file);
    assert.match(await prompt.execute(), /empty response three times/);
    assert.equal(calls(), 3);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(data.modelDiagnostics.length, 3);
    assert.equal(data.modelDiagnostics[0].finishReason, 'stop');
    assert.deepEqual(data.modelDiagnostics[1].invalidToolCalls, []);
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


test("a provider that loses a tool call gets namespace feedback and does not execute a guessed action", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-tool-repair-'));
  try {
    const file = path.join(dir, 'history.json');
    const lost = new AIMessage({ content: '', response_metadata: { finish_reason: 'tool_calls' } });
    const valid = new AIMessage({ content: '', tool_calls: [{ name: 'executeAux4', args: {command:'records list'}, id:'fixed', type:'tool_call' }] });
    const { prompt, calls } = fakePrompt([lost, valid, new AIMessage('done')], file);
    let invoked = 0;
    prompt.tools.executeAux4 = { invoke: async args => { invoked++; assert.equal(args.command, 'records list'); return 'records'; } };
    assert.equal(await prompt.execute(), 'done');
    assert.equal(calls(), 3);
    assert.equal(invoked, 1);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const feedback = data.messages.find(message => String(message.content).startsWith('The provider returned an unusable tool request'));
    assert.match(feedback.content, /CLI command path is not a tool name/);
    assert.equal(data.modelDiagnostics[0].kind, 'unusable-tool-request');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("invalid JSON tool arguments are diagnosed separately from blank answers", async () => {
  const malformed = new AIMessage({ content: '', invalid_tool_calls: [{name:'lookup',args:'{',error:'Invalid JSON',type:'invalid_tool_call'}] });
  const { prompt } = fakePrompt([malformed, lookup('fixed'), new AIMessage('done')]);
  assert.equal(await prompt.execute(), 'done');
  assert.equal(prompt.modelDiagnostics[0].kind, 'unusable-tool-request');
  assert.equal(prompt.modelDiagnostics[0].invalidToolCalls[0].args, '{');
  assert.match(prompt.messages[1].content, /Invalid JSON/);
});

test("three unusable provider requests stop with bounded feedback", async () => {
  const lost = () => new AIMessage({ content: '', response_metadata: {finish_reason:'tool_calls'} });
  const { prompt, calls } = fakePrompt([lost(),lost(),lost()]);
  assert.match(await prompt.execute(), /unusable tool request three times/);
  assert.equal(calls(), 3);
});


test("empty-lookup advice preserves raw tool data and adds no model call or automatic search", async () => {
  const call = (id,command) => new AIMessage({content:'',tool_calls:[{name:'executeAux4',args:{command},id,type:'tool_call'}]});
  const {prompt,calls} = fakePrompt([call('one','records list --query narrow'),call('two','records list'),new AIMessage('done')]);
  const invoked=[];
  prompt.tools.executeAux4={invoke:async ({command}) => {invoked.push(command);return invoked.length===1 ? '{"items":[]}' : '{"items":[{"id":"r7"}]}';}};
  assert.equal(await prompt.execute(),'done');
  assert.equal(calls(),3);
  assert.deepEqual(invoked,['records list --query narrow','records list']);
  const results=prompt.messages.filter(message=>message.role==='tool').map(message=>JSON.parse(message.content));
  assert.deepEqual(results,[{items:[]},{items:[{id:'r7'}]}]);
  assert.equal(prompt.messages.filter(message=>String(message.content).startsWith('A filtered lookup returned')).length,1);
});

test("repeated empty lookups get only one broadening hint per command family", async () => {
  const call = (id,query) => new AIMessage({content:'',tool_calls:[{name:'executeAux4',args:{command:'records list --query '+query},id,type:'tool_call'}]});
  const {prompt,calls}=fakePrompt([call('one','narrow'),call('two','broad'),new AIMessage('No matching record found.')]);
  let invoked=0;
  prompt.tools.executeAux4={invoke:async()=>{invoked++;return '{"items":[]}';}};
  await prompt.execute();
  assert.equal(calls(),3);
  assert.equal(invoked,2);
  assert.equal(prompt.messages.filter(message=>String(message.content).startsWith('A filtered lookup returned')).length,1);
});
