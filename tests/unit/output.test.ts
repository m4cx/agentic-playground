import { test } from "node:test";
import assert from "node:assert/strict";
import { extractLastJsonBlock, parseAgentOutput, validateAgentOutput } from "../../src/agent/output.js";

function block(value: unknown): string {
  return `Here is the result.\n\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;
}

const valid = {
  summary: "Implemented the change.",
  verification: ["npm test — passed"],
  openQuestions: [],
  couldNotComplete: [],
  prTitle: "Implement the change",
  prBody: "This implements the change.",
  state: "finished",
};

test("parses a valid output block", () => {
  const output = parseAgentOutput(block(valid));
  assert.equal(output.summary, "Implemented the change.");
  assert.equal(output.state, "finished");
});

test("uses the last json block", () => {
  const text = `${block({ ...valid, summary: "first" })}\n${block({ ...valid, summary: "last" })}`;
  assert.equal(parseAgentOutput(text).summary, "last");
});

test("rejects a missing block", () => {
  assert.throws(() => parseAgentOutput("no json here"), /no fenced json block/);
});

test("rejects invalid JSON", () => {
  assert.equal(extractLastJsonBlock("```json\nnot-json\n```"), "not-json");
  assert.throws(() => parseAgentOutput("```json\nnot-json\n```"), /not valid JSON/);
});

test("rejects unknown keys and over-long values", () => {
  assert.throws(() => validateAgentOutput({ ...valid, extra: true }), /unknown output key/);
  assert.throws(
    () => validateAgentOutput({ ...valid, summary: "x".repeat(4001) }),
    /summary must be/,
  );
});

test("waiting requires an open question", () => {
  assert.throws(
    () => validateAgentOutput({ ...valid, state: "waiting" }),
    /waiting requires/,
  );
});

test("rejects a pull request body that claims a merge", () => {
  assert.throws(
    () => validateAgentOutput({ ...valid, prBody: "I merged this change." }),
    /must not claim a merge/,
  );
});

test("a non-English prBody falls back to an empty field instead of failing the run", () => {
  const output = validateAgentOutput({ ...valid, prBody: "Das ist eine deutsche Beschreibung." });
  assert.equal(output.prBody, "");
});

test("a non-English prTitle falls back to an empty field", () => {
  const output = validateAgentOutput({ ...valid, prTitle: "修复登录超时" });
  assert.equal(output.prTitle, "");
});

test("rejects non-English text in the summary", () => {
  assert.throws(
    () =>
      validateAgentOutput({
        ...valid,
        summary: "Das ist ein Test und die Änderung ist nicht fertig.",
      }),
    /must be written in English/,
  );
});

test("redacts secrets in output", () => {
  const output = validateAgentOutput(
    { ...valid, summary: "The token is ghs_abcdefghijk." },
    ["ghs_abcdefghijk"],
  );
  assert.equal(output.summary, "The token is [redacted].");
});
