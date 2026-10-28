import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nextAction,
  renderAcknowledgement,
  renderFailure,
  renderOutcome,
  renderPermissionDenied,
  renderResult,
  renderStateComment,
} from "../../src/agent/messages.js";
import { createSession, createStateRecord } from "../../src/agent/state.js";

const trigger = {
  kind: "label" as const,
  actor: "maintainer",
  permission: "write" as const,
  at: "2026-10-28T10:00:00Z",
  commentId: null,
  commandText: null,
  labelName: "agent:run",
};

const session = createSession({
  issueNumber: 42,
  title: "Fix login timeout",
  trigger,
  now: "2026-10-28T10:00:00Z",
  slugMaxLength: 50,
  fingerprint: "a1b2c3d4",
  requestVersion: "sha256:abc",
});

const run = {
  id: "run-1",
  trigger,
  startedAt: "2026-10-28T10:01:00Z",
  endedAt: "2026-10-28T10:02:00Z",
  outcome: "finished" as const,
  piSessionId: session.piSessionId,
  commitShas: ["sha"],
  changedPaths: ["src/file.ts"],
  verification: ["npm test — passed"],
  failureReason: null,
  nextAction: null,
};

test("renders a state comment with the marker and table", () => {
  const record = createStateRecord(session, "run-1");
  const text = renderStateComment(record);
  assert.match(text, /### Agent session/);
  assert.match(text, /\*\*State\*\* \| accepted/);
  assert.match(text, /agent-session-state/);
});

test("renders an acknowledgement with a marker", () => {
  assert.match(renderAcknowledgement(session, "run-1"), /agent-ack:run-1/);
  assert.match(renderAcknowledgement(session, "run-1"), /feature\/42-fix-login-timeout/);
});

test("renders a result with all sections", () => {
  const text = renderResult({
    session: { ...session, state: "finished", pullRequestNumber: 7 },
    run,
    output: {
      summary: "Done.",
      verification: ["test passed"],
      openQuestions: [],
      couldNotComplete: [],
      prTitle: "Done",
      prBody: "Done.",
      state: "finished",
    },
    branchUrl: "https://example.test/branch",
    pullRequestUrl: "https://example.test/pr/7",
    blockedEgress: ["1.2.3.4:443"],
  });
  assert.match(text, /agent-run:run-1/);
  assert.match(text, /\*\*Summary\*\*/);
  assert.match(text, /\*\*Blocked network attempts\*\*/);
  assert.match(text, /Review the pull request/);
});

test("renders a failure with a reason and next action", () => {
  const text = renderFailure({
    session: { ...session, state: "failed" },
    run: { ...run, outcome: "failed" },
    reason: "timeout",
    message: "deadline reached",
    blockedEgress: [],
  });
  assert.match(text, /\*\*Reason:\*\* `timeout`/);
  assert.match(text, /Review the failure reason/);
});

test("renders merge and close outcomes", () => {
  assert.match(
    renderOutcome({
      issueNumber: 42,
      actor: "maintainer",
      at: "2026-10-28T13:00:00Z",
      merged: true,
      pullRequestNumber: 7,
      branch: "feature/42-fix-login-timeout",
    }),
    /was merged by/,
  );
  assert.match(
    renderOutcome({
      issueNumber: 42,
      actor: "maintainer",
      at: "2026-10-28T13:00:00Z",
      merged: false,
      pullRequestNumber: 7,
      branch: "feature/42-fix-login-timeout",
    }),
    /closed without merging/,
  );
});

test("permission denial is English and names the requirement", () => {
  assert.match(renderPermissionDenied("reader", "run-1"), /write access/);
});

test("nextAction covers every state", () => {
  assert.match(nextAction("finished"), /merge/);
  assert.match(nextAction("waiting"), /Answer/);
  assert.match(nextAction("failed"), /failure/);
  assert.match(nextAction("stopped"), /Reopen/);
});
