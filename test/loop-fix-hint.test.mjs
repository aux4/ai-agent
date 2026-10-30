import { test } from "node:test";
import assert from "node:assert/strict";
import { repeatFixHint, emptyLookupRecovery, isEmptyLookupResult, requiredInputRecovery, unansweredLookupRecovery, readResultKey, reusableReadResult } from "../src/lib/LoopHint.js";

test("repeatFixHint names the missing flag from aux4's own error", () => {
  const hint = repeatFixHint("Error executing command: Missing required parameter --messageId: The message ID to retrieve");
  assert.match(hint, /needs --messageId <value>/);
  assert.match(hint, /rename that flag to --messageId/);
});

test("repeatFixHint names the suggested flag for an unknown parameter", () => {
  const hint = repeatFixHint("Error executing command: Unknown parameter --event-id, did you mean --eventId?");
  assert.equal(hint, "The error names the fix: use --eventId instead of --event-id, then run it again.");
});

test("repeatFixHint says nothing for other repeated results", () => {
  assert.equal(repeatFixHint("{\"status\":\"ok\"}"), "");
  assert.equal(repeatFixHint(""), "");
});

test("repeatFixHint spells out the corrected command from a Did-you-mean", () => {
  const result = "Error executing command: Command not found: `browser` under `aux4 ai agent`.\nAvailable commands here: ask, chat\nDid you mean: aux4 agent browser find";
  const hint = repeatFixHint(result, 'ai agent browser find --url http://x/orders --question "Which order?"');
  assert.match(hint, /Run executeAux4 with command: agent browser find --url http:\/\/x\/orders --question "Which order\?"/);
});

test("correctedCommand swaps the wrong leading words for the suggested path", async () => {
  const { correctedCommand } = await import("../src/lib/LoopHint.js");
  assert.equal(correctedCommand("ai agent browser run --url x --goal y", "agent browser run"), "agent browser run --url x --goal y");
  assert.equal(correctedCommand("foo bar --a 1", "agent browser find"), "");
});


test("filtered misses get bounded broadening advice without changing the result", () => {
  const result = '{"records":[]}';
  const recovery = emptyLookupRecovery('records search --query "strict words"', result);
  assert.equal(recovery.family, 'records search');
  assert.match(recovery.message, /preserving every explicit user constraint/);
  assert.match(recovery.message, /one materially broader lookup/);
  assert.equal(result, '{"records":[]}');
  assert.equal(emptyLookupRecovery('records search', result), null);
  assert.equal(emptyLookupRecovery('records create --query strict', result), null);
  assert.equal(emptyLookupRecovery('records search --query strict', '{"records":[{"id":"r7"}]}'), null);
  assert.equal(emptyLookupRecovery('records search --query strict', '{"id":"r7","errors":[]}'), null);
  assert.equal(isEmptyLookupResult('records search --query strict','{"data":{"items":[]}}'), true);
});


test("required-input advice needs a structured missing-field result",()=>{
  for(const value of ['not JSON',{}, {status:'done',confirmation:{emptyFields:['token']}}, {status:'needs-input',confirmation:{emptyFields:[]}}, {status:'needs-input',confirmation:{emptyFields:[null,7,'']}}])
    assert.equal(requiredInputRecovery(value),null);
  const result=requiredInputRecovery({status:'needs-input',confirmation:{target:'form',emptyFields:['Badge number']}});
  assert.match(result.message,/Badge number/);
  assert.match(result.message,/Do not confirm or submit with empty or invented/);
});


test("explicit unanswered lookup feedback does not treat matches as an answer",()=>{
  const input={answered:false,matches:[{text:'Application form'}]};
  assert.match(unansweredLookupRecovery('forms find --question "badge number"',input).message,/headings or labels do not establish/);
  assert.equal(unansweredLookupRecovery('forms find',{...input,answered:true}),null);
  assert.equal(unansweredLookupRecovery('forms update',input),null);
  assert.equal(unansweredLookupRecovery('forms find','not JSON'),null);
});


test("missing-value feedback also reads the tool's structured field handoff",()=>{
  const hint=requiredInputRecovery({status:'needs-input',needsInput:{kind:'missing',field:{label:'Contact email'},page:{url:'https://example.test/apply'}}});
  assert.match(hint.message,/Contact email/);
  assert.equal(requiredInputRecovery({status:'needs-input',needsInput:{kind:'confirm',field:{label:'Save'}}}),null);
});


test("negative lookup keys ignore ranking metadata but preserve the question and source", () => {
  const first = JSON.stringify({answered:false,question:"Which reference applies?",url:"https://example.test/records",session:"s1",answerScore:0.03,matches:[{text:"References",score:0.02}]});
  const reranked = JSON.stringify({answered:false,question:"Which reference applies?",url:"https://example.test/records",session:"s2",answerScore:0.04,matches:[{text:"Reference list",score:0.05}],wallMs:999});
  assert.equal(readResultKey(first), readResultKey(reranked));
  assert.equal(reusableReadResult('records find --url https://example.test/records --question "Which reference applies?" --provider alternate', readResultKey(first)), true);
  assert.equal(reusableReadResult('records find --url=https://example.test/records --question="Which reference applies?"', readResultKey(first)), true);
  assert.equal(reusableReadResult('records find --url https://example.test/elsewhere --question "Which reference applies?"', readResultKey(first)), false);
  assert.equal(reusableReadResult('records find --url https://example.test/records --question "Who owns the record?"', readResultKey(first)), false);
  assert.notEqual(readResultKey('{"answered":true,"answer":"one"}'), readResultKey('{"answered":true,"answer":"two"}'));
  assert.notEqual(readResultKey('{"id":"r1","score":1}'), readResultKey('{"id":"r1","score":2}'));
});
