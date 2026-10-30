import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  commandResultFailed,
  changeResultCompleted,
  mutationTarget,
  sameMutationTarget,
  wrapWithLoopDetection
} from "../src/lib/Tools.js";

const firstCreate = "google calendar events create --summary \"Vendor sync meeting\" --start \"2026-03-20T10:00:00Z\" --end \"2026-03-20T10:30:00Z\"";
const cosmeticVariant = "google calendar events create --calendarId primary --description \"Unique description 123\" --end \"2026-03-20T10:30:00Z\" --start \"2026-03-20T10:00:00Z\" --summary \"Vendor sync meeting\"";

test("mutationTarget identifies a change by command and stable target fields", () => {
  const first = mutationTarget("executeAux4", { command: firstCreate });
  const repeated = mutationTarget("executeAux4", { command: cosmeticVariant });
  const differentTime = mutationTarget("executeAux4", { command: cosmeticVariant.replace("10:00:00Z", "11:00:00Z") });

  assert.equal(sameMutationTarget(first, repeated), true);
  assert.equal(sameMutationTarget(first, differentTime), false);
  assert.equal(mutationTarget("executeAux4", { command: "google calendar events list --summary \"Vendor sync meeting\"" }), null);
});

test("a successful change is refused on a second call to the same target", async () => {
  let calls = 0;
  const guarded = wrapWithLoopDetection("executeAux4", {
    description: "execute aux4",
    schema: z.object({ command: z.string() }),
    invoke: async () => {
      calls++;
      return '{"kind":"calendar#event","status":"confirmed"}';
    }
  });

  assert.match(String(await guarded.invoke({ command: firstCreate })), /calendar#event/);
  const repeated = String(await guarded.invoke({ command: cosmeticVariant }));
  assert.match(repeated, /already succeeded in this run/);
  assert.equal(calls, 1);
});

test("parallel changes to the same target reserve it before the first call completes", async () => {
  let calls = 0;
  let finishFirst;
  const guarded = wrapWithLoopDetection("executeAux4", {
    description: "execute aux4",
    schema: z.object({ command: z.string() }),
    invoke: async () => {
      calls++;
      return new Promise(resolve => { finishFirst = resolve; });
    }
  });

  const first = guarded.invoke({ command: firstCreate });
  await new Promise(resolve => setImmediate(resolve));
  const repeated = String(await guarded.invoke({ command: cosmeticVariant }));
  assert.match(repeated, /already running/);
  assert.equal(calls, 1);

  finishFirst('{"kind":"calendar#event","status":"confirmed"}');
  assert.match(String(await first), /calendar#event/);
});

test("the same parsed read scope stops after repeated identical evidence", async () => {
  let calls = 0;
  const help = "list\nList records.\nget\nGet one record.";
  const guarded = wrapWithLoopDetection("executeAux4", {
    description: "execute aux4",
    schema: z.object({ command: z.string() }),
    invoke: async () => { calls++; return help; }
  });

  await guarded.invoke({ command: 'google calendar events --query "open events"' });
  await guarded.invoke({ command: "google calendar events --query 'open events'" });
  const third = String(await guarded.invoke({ command: "google calendar events   --query   \"open events\"" }));

  assert.match(third, /this read scope has already returned identical evidence twice/);
  assert.equal(calls, 2);
});

test("a distinct query executes after earlier scopes returned the same evidence", async () => {
  let calls = 0;
  const guarded = wrapWithLoopDetection("executeAux4", {
    description: "execute aux4", schema: z.object({ command: z.string() }),
    invoke: async ({command}) => {
      calls++;
      return command.includes("broader")
        ? '{"records":[{"id":"r1"},{"id":"r2"}]}'
        : '{"records":[{"id":"r1"}]}';
    }
  });
  await guarded.invoke({command:"records list --query narrow-a"});
  await guarded.invoke({command:"records list --query narrow-b"});
  const broader = String(await guarded.invoke({command:"records list --query broader"}));
  assert.deepEqual(JSON.parse(broader), {records:[{id:"r1"},{id:"r2"}]});
  assert.equal(calls, 3);
});

test("target and source arguments form independent read scopes", async () => {
  let calls=0;
  const guarded=wrapWithLoopDetection("executeAux4",{
    description:"execute aux4",schema:z.object({command:z.string()}),
    invoke:async()=>{calls++;return '{"records":[{"id":"same"}]}' ;}
  });
  await guarded.invoke({command:"records list --target alpha"});
  await guarded.invoke({command:"records list --target beta"});
  await guarded.invoke({command:"records list --source archive --target beta"});
  assert.equal(calls,3);
});

test("different evidence and goal-level browser runs are still allowed", async () => {
  let calls = 0;
  const guarded = wrapWithLoopDetection("executeAux4", {
    description: "execute aux4",
    schema: z.object({ command: z.string() }),
    invoke: async () => `result-${++calls}`
  });

  await guarded.invoke({ command: "google calendar events list --query first" });
  await guarded.invoke({ command: "google calendar events list --query second" });
  await guarded.invoke({ command: "google calendar events list --query third" });
  assert.equal(calls, 3);

  await guarded.invoke({ command: "agent browser run --url http://example.test --goal first" });
  await guarded.invoke({ command: "agent browser run --url http://example.test --goal second" });
  await guarded.invoke({ command: "agent browser run --url http://example.test --goal third" });
  assert.equal(calls, 6);
});

test("a failed change does not block a corrected retry for that target", async () => {
  let calls = 0;
  const guarded = wrapWithLoopDetection("executeAux4", {
    description: "execute aux4",
    schema: z.object({ command: z.string() }),
    invoke: async () => {
      calls++;
      return calls === 1 ? "Error executing command: missing required parameter" : "created";
    }
  });

  assert.match(String(await guarded.invoke({ command: firstCreate })), /missing required parameter/);
  assert.equal(String(await guarded.invoke({ command: cosmeticVariant })), "created");
  assert.equal(calls, 2);
});

test("commandResultFailed recognizes executor failures, policy denials, and API error objects", () => {
  assert.equal(commandResultFailed("Not run: this action was already completed"), true);
  assert.equal(commandResultFailed("⛔ policy denied_action: denied"), true);
  assert.equal(commandResultFailed('{"error":{"message":"invalid event"}}'), true);
  assert.equal(commandResultFailed('{"kind":"calendar#event","status":"confirmed"}'), false);
});


test("read-family limits allow documentation and a corrected child command", async () => {
  const commands = [];
  const guarded = wrapWithLoopDetection("executeAux4", {
    description: "execute aux4",
    schema: z.object({ command: z.string() }),
    invoke: async ({ command }) => {
      commands.push(command);
      return command.includes("--help") || command.endsWith("-h")
        ? "get --recordId: read a record" : '{"records":[{"id":"r7"}]}';
    }
  });
  await guarded.invoke({ command: 'records list --query "first"' });
  await guarded.invoke({ command: "records list --query 'first'" });
  assert.match(String(await guarded.invoke({ command: "records list --query first" })), /this read scope has already returned identical evidence twice/);
  assert.match(String(await guarded.invoke({ command: "records list --help" })), /recordId/);
  assert.match(String(await guarded.invoke({ command: "records list -h" })), /recordId/);
  assert.match(String(await guarded.invoke({ command: "records get --recordId r7" })), /r7/);
  assert.equal(commands.length, 5);
});


test("the first parameter error supplies recovery guidance without retrying the tool", async () => {
  let calls = 0;
  const guarded = wrapWithLoopDetection("executeAux4", {
    description: "execute aux4", schema: z.object({ command: z.string() }),
    invoke: async () => { calls++; return "Error executing command: Unknown parameter --id"; }
  });
  const result = String(await guarded.invoke({ command: "records get --id r7" }));
  assert.match(result, /Unknown parameter --id/);
  assert.match(result, /exact --help/);
  assert.equal(calls, 1);
});


test("consecutive novel scopes with no new evidence exhaust a truthful bounded budget", async () => {
  let calls = 0;
  const guarded = wrapWithLoopDetection("executeAux4", {
    description: "execute aux4", schema: z.object({ command: z.string() }),
    invoke: async () => { calls++; return '{"records":[{"id":"r7","status":"inactive"}]}'; }
  });
  await guarded.invoke({ command: "records list --query first" });
  let aborted = false;
  let budgetReached = false;
  for (let i = 0; i < 10; i++) {
    let result;
    try {
      result = String(await guarded.invoke({ command: `records list --format format-${i} --limit ${i + 1}` }));
    } catch (error) {
      assert.equal(error.loopAbort, true);
      assert.match(error.message, /Read exploration budget exhausted/);
      assert.match(error.message, /untried scope has not been checked/);
      aborted = true;
      break;
    }
    if (/Read exploration budget exhausted/.test(result)) {
      budgetReached = true;
      assert.match(result, /untried scope has not been checked/);
      assert.match(result, /r7/);
    } else {
      assert.deepEqual(JSON.parse(result), {records:[{id:"r7",status:"inactive"}]});
    }
  }
  assert.equal(budgetReached, true);
  assert.equal(aborted, true);
  assert.equal(calls, 7);
});

test("new evidence resets a nearly exhausted novel-scope budget", async () => {
  let calls=0;
  const guarded=wrapWithLoopDetection("executeAux4",{
    description:"execute aux4",schema:z.object({command:z.string()}),
    invoke:async ({command})=>{
      calls++;
      return command.includes("new-fact")
        ? '{"records":[{"id":"new"}]}'
        : '{"records":[{"id":"existing"}]}' ;
    }
  });
  await guarded.invoke({command:"records list --query base"});
  for(let i=0;i<5;i++) {
    assert.match(String(await guarded.invoke({command:`records list --query before-${i}`})),/existing/);
  }
  assert.deepEqual(JSON.parse(String(await guarded.invoke({command:"records list --query new-fact"}))),{records:[{id:"new"}]});
  for(let i=0;i<6;i++) {
    const result=String(await guarded.invoke({command:`records list --query after-${i}`}));
    assert.doesNotMatch(result,/budget exhausted/);
  }
  assert.match(String(await guarded.invoke({command:"records list --query next-untried"})),/Read exploration budget exhausted/);
  assert.match(String(await guarded.invoke({command:"records list --query next-untried-2"})),/Read exploration budget exhausted/);
  assert.equal(calls,13);
});

test("new evidence resets the no-progress scope budget and targets remain independent", async () => {
  let calls = 0;
  const guarded = wrapWithLoopDetection("executeAux4", {
    description:"execute aux4", schema:z.object({command:z.string()}),
    invoke:async ({command}) => {
      calls++;
      const page=command.match(/--page (\d+)/)?.[1];
      if (command.includes("--recordId second")) return '{"records":[{"id":"second"}]}';
      if (page) return JSON.stringify({records:[{id:`page-${page}`} ]});
      return '{"records":[{"id":"same"}]}';
    }
  });
  await guarded.invoke({command:"records list --query q1"});
  for (let page=2;page<=7;page++) {
    const result=String(await guarded.invoke({command:`records list --page ${page}`}));
    assert.doesNotMatch(result,/budget exhausted/);
  }
  assert.deepEqual(JSON.parse(String(await guarded.invoke({command:"records list --page 4 --refresh true"}))),{records:[{id:"page-4"}]});
  const distinctTarget=String(await guarded.invoke({command:"records list --recordId second"}));
  assert.deepEqual(JSON.parse(distinctTarget),{records:[{id:"second"}]});
  assert.equal(calls,9);
});

test("new evidence resets prior read-refusal escalation", async () => {
  let calls=0;
  const guarded=wrapWithLoopDetection("executeAux4",{
    description:"execute aux4",schema:z.object({command:z.string()}),
    invoke:async ({command})=>{
      calls++;
      return command.includes("second")
        ? '{"records":[{"id":"new"}]}'
        : '{"records":[{"id":"existing"}]}';
    }
  });
  await guarded.invoke({command:'records list --query "first"'});
  await guarded.invoke({command:"records list --query 'first'"});
  assert.match(String(await guarded.invoke({command:'records list --query  "first"'})),/this read scope has already returned identical evidence twice/);
  assert.match(String(await guarded.invoke({command:'records list   --query "first"'})),/this read scope has already returned identical evidence twice/);

  await guarded.invoke({command:'records list --query "second"'});
  await guarded.invoke({command:"records list --query 'second'"});
  assert.match(String(await guarded.invoke({command:'records list --query  "second"'})),/this read scope has already returned identical evidence twice/);
  assert.equal(calls,4);
});


test("two filtered misses cannot prohibit a broader lookup that finds new evidence", async () => {
  let calls = 0;
  const guarded = wrapWithLoopDetection('executeAux4', {
    description:'execute aux4', schema:z.object({command:z.string()}),
    invoke:async () => ++calls < 3 ? '{"records":[]}' : '{"records":[{"id":"r7"}]}'
  });
  assert.deepEqual(JSON.parse(String(await guarded.invoke({command:'records list --query "narrow words"'}))), {records:[]});
  await guarded.invoke({command:'records list --query "still narrow"'});
  assert.deepEqual(JSON.parse(String(await guarded.invoke({command:'records list'}))), {records:[{id:'r7'}]});
  assert.equal(calls,3);
});


test("pending input is not a completed change and a valid continuation remains executable",async()=>{
  let calls=0;
  const guarded=wrapWithLoopDetection('executeAux4',{description:'execute aux4',schema:z.object({command:z.string()}),invoke:async()=>++calls===1?'{"status":"needs-input","submitted":false}':'{"status":"done","submitted":true}'});
  assert.match(String(await guarded.invoke({command:firstCreate})),/needs-input/);
  assert.match(String(await guarded.invoke({command:cosmeticVariant})),/done/);
  assert.match(String(await guarded.invoke({command:firstCreate})),/already succeeded/);
  assert.equal(calls,2);
});

test("completion detection preserves accepted asynchronous changes but excludes explicitly unsubmitted work",()=>{
  for(const value of ['{"status":"needs-input"}','{"status":"needs-confirmation"}','{"status":"done","submitted":false}','{"status":"incomplete"}'])assert.equal(changeResultCompleted(value),false);
  assert.equal(changeResultCompleted('{"status":"pending","id":"job7"}'),true);
  assert.equal(changeResultCompleted('saved'),true);
});


test("negative lookup metadata cannot extend a loop, while new questions, sources and changed state remain readable", async () => {
  let calls = 0;
  const guarded = wrapWithLoopDetection("executeAux4", {
    description: "execute aux4", schema:z.object({command:z.string()}),
    invoke:async ({command}) => {
      calls++;
      if (command.startsWith("records run")) return '{"status":"done"}';
      const question = command.includes("Another question") ? "Another question" : "Which reference applies?";
      const url = command.includes("elsewhere") ? "https://example.test/elsewhere" : "https://example.test/records";
      return JSON.stringify({answered:false, question, url, session:`s${calls}`,answerScore:calls/100,matches:[{text:`Heading ${calls}`,score:calls/10}]});
    }
  });
  const base = 'records find --url https://example.test/records --question "Which reference applies?"';
  await guarded.invoke({command:base});
  await guarded.invoke({command:base+' --provider alternate'});
  assert.match(String(await guarded.invoke({command:base+' --granularity sentence'})), /identical evidence twice/);
  assert.equal(calls, 2);
  assert.match(String(await guarded.invoke({command:base.replace("Which reference applies?","Another question")})), /answered/);
  assert.match(String(await guarded.invoke({command:base.replace("/records","/elsewhere")})), /answered/);
  await guarded.invoke({command:"records run --goal update"});
  assert.match(String(await guarded.invoke({command:base})), /answered/);
  assert.equal(calls, 6);
});


test("recovery carries negative read evidence within one request and refreshes it for a later request", async () => {
  const command = 'records find --url https://example.test/records --question "Which reference applies?"';
  const result = JSON.stringify({answered:false,question:"Which reference applies?",url:"https://example.test/records"});
  const messages = [
    {role:"assistant_with_tool",content:{kwargs:{tool_calls:[{id:"a",name:"executeAux4",args:{command}}]}}},
    {role:"tool",tool_call_id:"a",timestamp:101,content:result},
    {role:"assistant_with_tool",content:{tool_calls:[{id:"b",name:"executeAux4",args:{command:command+" --provider alternate"}}]}},
    {role:"tool",tool_call_id:"b",timestamp:102,content:result}
  ];
  let calls = 0;
  const underlying = {description:"execute",schema:z.object({command:z.string()}),invoke:async () => { calls++; return result; }};
  const recovery = wrapWithLoopDetection("executeAux4", underlying, {getMessages:() => messages,historySince:100});
  assert.match(String(await recovery.invoke({command:command+" --granularity sentence"})), /identical evidence twice/);
  assert.equal(calls, 0);
  await recovery.invoke({command:command.replace("Which reference applies?","Another question")});
  assert.equal(calls, 1);
  const nextRequest = wrapWithLoopDetection("executeAux4", underlying, {getMessages:() => messages,historySince:200});
  await nextRequest.invoke({command});
  assert.equal(calls, 2);
  const legacy = messages.map(({timestamp, ...message}) => message);
  const unversioned = wrapWithLoopDetection("executeAux4", underlying, {getMessages:() => legacy,historySince:200});
  await unversioned.invoke({command});
  assert.equal(calls, 3);
});


test("an unsearchable source cannot be repaired by another question, but a new source stays available", async () => {
  let calls=0;
  const guarded=wrapWithLoopDetection("executeAux4",{description:"execute",schema:z.object({command:z.string()}),invoke:async ({command})=>{calls++;return JSON.stringify({answered:false,sourceState:"unsearchable",url:command.includes("elsewhere")?"https://example.test/elsewhere":"https://example.test/source",question:"Which reference applies?"});}});
  await guarded.invoke({command:'records find --url https://example.test/source --question "Which reference applies?"'});
  assert.match(String(await guarded.invoke({command:'records find --url https://example.test/source --question "List all entries" --provider alternate'})),/identical evidence once/);
  assert.equal(calls,1);
  await guarded.invoke({command:'records find --url https://example.test/elsewhere --question "Which reference applies?"'});
  assert.equal(calls,2);
});
