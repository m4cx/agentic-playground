import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertTransition,
  branchNameFor,
  canTransition,
  createSession,
  createStateRecord,
  issueNumberFromBranch,
  parseStateMarker,
  renderStateMarker,
  validateSession,
  validateStateRecord,
} from "../../src/agent/state.js";

const trigger = {
  kind: "label" as const,
  actor: "maintainer",
  permission: "write" as const,
  at: "2026-10-28T10:00:00Z",
  commentId: null,
  commandText: null,
  labelName: "agent:run",
};

function session() {
  return createSession({
    issueNumber: 42,
    title: "Fix login timeout",
    trigger,
    now: "2026-10-28T10:00:00Z",
    slugMaxLength: 50,
    fingerprint: "a1b2c3d4",
    requestVersion: "sha256:abc",
  });
}

test("creates a session with the expected identity", () => {
  const value = session();
  assert.equal(value.id, "issue-42");
  assert.equal(value.branchName, "feature/42-fix-login-timeout");
  assert.equal(value.piSessionId, "issue-42-a1b2c3d4");
  assert.equal(value.state, "accepted");
});

test("state marker round-trips", () => {
  const record = createStateRecord(session(), "run-1");
  const parsed = parseStateMarker(renderStateMarker(record));
  assert.deepEqual(parsed, record);
});

test("marker returns null when absent", () => {
  assert.equal(parseStateMarker("ordinary comment"), null);
});

test("marker rejects invalid JSON and schema", () => {
  assert.throws(
    () => parseStateMarker("<!-- agent-session-state {not-json} -->"),
    /not valid JSON/,
  );
  const record = createStateRecord(session(), "run-1");
  const bad = { ...record, schema: 2 };
  assert.throws(
    () => parseStateMarker(`<!-- agent-session-state ${JSON.stringify(bad)} -->`),
    /schema/,
  );
});

test("session validation rejects a branch mismatch", () => {
  const value = session();
  value.branchName = "feature/42-other";
  assert.throws(() => validateSession(value, 42), /branchName/);
});

test("session validation rejects an issue mismatch", () => {
  assert.throws(() => validateSession(session(), 7), /does not match/);
});

test("transition table accepts and rejects the right edges", () => {
  assert.equal(canTransition("accepted", "working"), true);
  assert.equal(canTransition("working", "finished"), true);
  assert.equal(canTransition("waiting", "working"), true);
  assert.equal(canTransition("finished", "working"), true);
  assert.equal(canTransition("stopped", "working"), true);
  assert.equal(canTransition("finished", "stopped"), false);
  assert.throws(() => assertTransition("finished", "stopped"), /invalid session transition/);
});

test("issue number is parsed from the branch name", () => {
  assert.equal(issueNumberFromBranch("feature/42-fix-login-timeout"), 42);
  assert.equal(issueNumberFromBranch("feature/not-a-number"), null);
  assert.equal(branchNameFor(7, "do-it"), "feature/7-do-it");
});

test("state record validates a full record", () => {
  const record = createStateRecord(session(), "run-1");
  assert.equal(validateStateRecord(record, 42).session.id, "issue-42");
});
