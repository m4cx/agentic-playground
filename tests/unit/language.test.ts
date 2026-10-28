import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAgentOutput } from "../../src/agent/output.js";

const base = {
  summary: "Implemented the change.",
  verification: ["npm test — passed"],
  openQuestions: [],
  couldNotComplete: [],
  prTitle: "Implement the change",
  prBody: "This implements the change.",
  state: "finished",
};

test("rejects German prose in a durable field", () => {
  assert.throws(
    () =>
      validateAgentOutput({
        ...base,
        summary: "Das ist ein Test und die Änderung ist nicht fertig.",
      }),
    /English/,
  );
});

test("rejects a non-Latin script in a durable field", () => {
  assert.throws(
    () => validateAgentOutput({ ...base, summary: "实现了请求的更改。" }),
    /English/,
  );
});

test("accepts English technical prose", () => {
  const output = validateAgentOutput({
    ...base,
    summary: "Updated the login timeout and added a regression test for the cookie path.",
    verification: ["npm test — 42 passed", "npm run build — passed"],
  });
  assert.equal(output.state, "finished");
});
