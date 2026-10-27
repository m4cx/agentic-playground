import assert from "node:assert/strict";
import test from "node:test";

import { renderSession } from "../../src/agent/messages.js";
import {
  accountingFromMessages,
  endedBecauseFor,
  parseSessionMessage,
  SessionAccounting,
  type SessionRecord,
} from "../../src/agent/session-accounting.js";

function record(sessionId: string, costUsd: number, runIds = ["run-1"]): SessionRecord {
  return {
    sessionId,
    fingerprint: "fingerprint123",
    runIds,
    costUsd,
    tokens: 1000,
    turns: 2,
    toolCalls: 3,
    endedBecause: "finished",
  };
}

function message(input: { sessionId: string; costUsd: number; runId: string; endedBecause?: "run finished" | "cache lost" }): string {
  return renderSession({
    issueNumber: 7,
    sessionId: input.sessionId,
    fingerprint: "fingerprint123",
    runIds: [input.runId],
    costUsd: input.costUsd,
    tokens: 1000,
    turns: 2,
    toolCalls: 3,
    endedBecause: input.endedBecause ?? "run finished",
    issueTotalUsd: input.costUsd,
    capUsd: 5,
  });
}

test("two sessions add up, and a lost cache does not reset the total", () => {
  const accounting = new SessionAccounting();
  accounting.record(record("session-a", 1.5, ["run-1"]));
  accounting.record(record("session-b", 0.75, ["run-2"]));
  assert.equal(accounting.totalCostUsd, 2.25);
  assert.equal(accounting.total().tokens, 2000);
  assert.equal(accounting.records.length, 2);
});

test("a duplicated record is a defect, not a silent double count", () => {
  const accounting = new SessionAccounting();
  accounting.record(record("session-a", 1));
  assert.throws(() => accounting.record(record("session-a", 1)), /already documented/);
});

test("a session may span runs without being double counted per run", () => {
  const accounting = new SessionAccounting();
  accounting.record(record("session-a", 1, ["run-1"]));
  accounting.record(record("session-a", 0.5, ["run-2"]));
  assert.equal(accounting.totalCostUsd, 1.5);
});

test("session messages parse back into records", () => {
  const parsed = parseSessionMessage(message({ sessionId: "agent-issue-7-abc", costUsd: 0.42, runId: "run-9" }));
  assert.ok(parsed !== null);
  assert.equal(parsed.sessionId, "agent-issue-7-abc");
  assert.equal(parsed.costUsd, 0.42);
  assert.deepEqual(parsed.runIds, ["run-9"]);
  assert.equal(parsed.endedBecause, "finished");
});

test("a lost-cache session parses as lost", () => {
  const parsed = parseSessionMessage(
    message({ sessionId: "agent-issue-7-abc", costUsd: 0.1, runId: "run-9", endedBecause: "cache lost" }),
  );
  assert.equal(parsed?.endedBecause, "lost");
});

test("the documented record rebuilds from the thread", () => {
  const bodies = [
    message({ sessionId: "s1", costUsd: 1, runId: "run-1" }),
    message({ sessionId: "s2", costUsd: 2, runId: "run-2" }),
    "<!-- agent:ack issue=7 run=run-1 -->\nnot a session",
  ];
  const accounting = accountingFromMessages(bodies);
  assert.equal(accounting.records.length, 2);
  assert.equal(accounting.totalCostUsd, 3);
});

test("endedBecause reports lost only when a session existed and disappeared", () => {
  assert.equal(endedBecauseFor(false, false, "finished"), "finished");
  assert.equal(endedBecauseFor(true, false, "halted"), "lost");
  assert.equal(endedBecauseFor(true, true, "halted"), "halted");
});

test("the current session is added to the documented baseline", () => {
  const accounting = new SessionAccounting([record("s1", 1)]);
  const combined = accounting.withCurrentSession({
    costUsd: 0.5,
    tokens: 10,
    turns: 1,
    toolCalls: 2,
    assistantMessages: 1,
  });
  assert.equal(combined.costUsd, 1.5);
  assert.equal(combined.turns, 1 + 2);
});

test("a session message without the expected shape is ignored", () => {
  assert.equal(parseSessionMessage("Session ended.\n\nnothing structured here"), null);
});
