import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createAskUserTool } from "../src/lib/Tools.js";

test("askUser reports no answer in a non-interactive session without authorizing a guess", async () => {
  const tool = createAskUserTool({
    stdin: { isTTY: false },
    stderr: { write() {} },
    createInterface() {
      assert.fail("non-interactive askUser must not create a prompt");
    }
  });

  const result = await tool.invoke({ question: "Which priority is on file?" });

  assert.match(result, /^NO_ANSWER:/);
  assert.match(result, /no user response was received/i);
  assert.match(result, /not user authorization or evidence/i);
  assert.match(result, /required factual value is still missing/i);
  assert.match(result, /discretionary choices the user authorized/i);
  assert.doesNotMatch(result, /proceed with your best judgment/i);
});

test("askUser preserves an interactive user-authorized default answer", async () => {
  const writes = [];
  const answer = "Use the form's default priority, medium.";
  const stderr = { write(value) { writes.push(value); } };
  const tool = createAskUserTool({
    stdin: { isTTY: true },
    stderr,
    createInterface({ input, output }) {
      assert.equal(input.isTTY, true);
      assert.equal(output, stderr);
      const rl = new EventEmitter();
      rl.close = () => {};
      queueMicrotask(() => rl.emit("line", answer));
      return rl;
    }
  });

  const result = await tool.invoke({ question: "May I use the form default?" });

  assert.equal(result, `User responded: ${answer}`);
  assert.deepEqual(writes, ["\n🤖 May I use the form default?\n> "]);
});
