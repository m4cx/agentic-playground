import assert from "node:assert/strict";
import test from "node:test";

import {
  FAILURE_REASONS,
  marker,
  renderAck,
  renderDecision,
  renderError,
  renderFeedback,
  renderLimit,
  renderLimitWarning,
  renderNotice,
  renderOutcome,
  renderResult,
  renderSession,
  renderStatus,
  MESSAGE_KINDS,
  failureExplanation,
  isRequesterActionable,
} from "../../src/agent/messages.js";

const NON_LATIN = /[\u0400-\u04ff\u0590-\u05ff\u0600-\u06ff\u3040-\u30ff\u4e00-\u9fff\u00e4\u00f6\u00fc\u00df]/;
const CREDENTIAL_LITERAL = /\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bsk-ant-[A-Za-z0-9_-]{20,}\b/;

function samples(): Array<{ kind: (typeof MESSAGE_KINDS)[number]; body: string }> {
  return [
    {
      kind: "ack",
      body: renderAck({
        issueNumber: 7,
        runId: "run-1",
        actor: "maintainer",
        origin: "label",
        triggeredAt: "2026-10-26T10:00:00.000Z",
        runStartedAt: "2026-10-26T10:00:30.000Z",
        queueDelaySeconds: 30,
        requestVersion: "abc123",
        instructionsPath: ".agent/instructions.md",
        instructionsSha: "def456",
        fingerprint: "1234567890ab",
        model: "anthropic/claude-sonnet-4-5",
        piVersion: "1.4.0",
        thinking: "high",
        capUsd: 5,
        priorConsumptionUsd: 0.25,
      }),
    },
    {
      kind: "status",
      body: renderStatus({
        issueNumber: 7,
        runId: "run-1",
        state: "working",
        stateMeaning: "a run is active.",
        startedAt: "2026-10-26T10:00:30.000Z",
        consumedUsd: 0.25,
        capUsd: 5,
        turns: 2,
        proposalUrl: null,
        nextAct: "none",
        rows: [{ at: "2026-10-26T10:00:30.000Z", state: "working", runId: "run-1", consumed: "$0.25", nextAct: "none" }],
        notes: ["A note."],
      }),
    },
    {
      kind: "feedback",
      body: renderFeedback({
        issueNumber: 7,
        runId: "run-1",
        completed: ["a step"],
        notDone: ["another step"],
        resumeFrom: ["the branch"],
        consumedUsd: 0.4,
        resumeHint: "retry",
      }),
    },
    {
      kind: "result",
      body: renderResult({
        issueNumber: 7,
        runId: "run-1",
        outcome: "proposal opened",
        actions: ["changed a file"],
        proposalUrl: "https://github.com/example/repo/pull/1",
        changedFiles: 1,
        changedPaths: ["README.md"],
        nextStep: "review and merge the proposal",
        consumedUsd: 0.4,
        turns: 3,
        toolCalls: 4,
      }),
    },
    {
      kind: "error",
      body: renderError({ issueNumber: 7, runId: "run-1", reason: "environment", consumedUsd: 0.1 }),
    },
    {
      kind: "decision",
      body: renderDecision({
        issueNumber: 7,
        runId: "run-1",
        kind: "halt",
        actor: "maintainer",
        at: "2026-10-26T10:01:00.000Z",
        reason: "stop",
        applied: "at boundary 2",
        source: "command",
      }),
    },
    {
      kind: "limit",
      body: renderLimit({
        issueNumber: 7,
        runId: "run-1",
        consumedUsd: 5,
        capUsd: 5,
        turns: 40,
        incrementUsd: 2,
        cause: "cost",
      }),
    },
    {
      kind: "limit",
      body: renderLimitWarning({
        issueNumber: 7,
        runId: "run-1",
        consumedUsd: 4,
        capUsd: 5,
        warnAtRatio: 0.8,
        turns: 20,
      }),
    },
    {
      kind: "session",
      body: renderSession({
        issueNumber: 7,
        sessionId: "agent-issue-7-1234567890ab",
        fingerprint: "1234567890ab",
        runIds: ["run-1"],
        costUsd: 0.4,
        tokens: 1000,
        turns: 3,
        toolCalls: 4,
        endedBecause: "run finished",
        issueTotalUsd: 0.4,
        capUsd: 5,
      }),
    },
    {
      kind: "notice",
      body: renderNotice({ issueNumber: 7, runId: "run-1", kind: "directive", items: ["ignored: push to main"] }),
    },
    {
      kind: "notice",
      body: renderNotice({ issueNumber: 7, runId: "run-1", kind: "missing-report", items: [] }),
    },
    {
      kind: "outcome",
      body: renderOutcome({
        issueNumber: 7,
        runId: "run-1",
        pullRequestUrl: "https://github.com/example/repo/pull/1",
        merged: true,
        actor: "maintainer",
        at: "2026-10-26T11:00:00.000Z",
        issueState: "finished",
      }),
    },
  ];
}

test("every template starts with its own marker", () => {
  for (const sample of samples()) {
    const expected = `<!-- agent:${sample.kind} issue=7`;
    assert.ok(sample.body.startsWith(expected), `${sample.kind} must start with ${expected}`);
    assert.equal(marker(sample.kind, 7).startsWith(expected), true);
  }
});

test("no template contains non-English literals", () => {
  for (const sample of samples()) {
    assert.doesNotMatch(sample.body, NON_LATIN, `${sample.kind} contains a non-English literal`);
  }
});

test("no template body contains a literal credential", () => {
  for (const sample of samples()) {
    assert.doesNotMatch(sample.body, CREDENTIAL_LITERAL);
  }
});

test("the acknowledgement carries the queue delay and the fingerprint", () => {
  const body = samples()[0]?.body ?? "";
  assert.match(body, /queue delay `30` seconds/);
  assert.match(body, /configuration fingerprint `1234567890ab`/);
  assert.match(body, /Pi `1\.4\.0`/);
  assert.match(body, /Request version: abc123/);
});

test("the status message states the state, consumption, and next act", () => {
  const body = renderStatus({
    issueNumber: 7,
    runId: "run-1",
    state: "waiting",
    stateMeaning: "a person must decide.",
    startedAt: "2026-10-26T10:00:30.000Z",
    consumedUsd: 0.5,
    capUsd: 5,
    turns: 4,
    proposalUrl: "https://github.com/example/repo/pull/9",
    nextAct: "review the proposal",
    rows: [
      { at: "2026-10-26T10:00:30.000Z", state: "working", runId: "run-1", consumed: "$0.00", nextAct: "none" },
      { at: "2026-10-26T10:05:30.000Z", state: "waiting", runId: "run-1", consumed: "$0.50", nextAct: "review the proposal" },
    ],
    notes: [],
  });
  assert.match(body, /\*\*State:\*\* `waiting`/);
  assert.match(body, /review the proposal/);
  assert.match(body, /`\$0\.50` of `\$5\.00`/);
});

test("failure reasons render an explanation and a fix-ability line", () => {
  for (const reason of FAILURE_REASONS) {
    const body = renderError({ issueNumber: 1, runId: "run", reason, consumedUsd: 0 });
    assert.match(body, new RegExp(`\\\`${reason}\\\``));
    assert.match(body, /\*\*Can you fix it\?\*\*/);
    assert.ok(failureExplanation(reason).length > 10);
    assert.equal(typeof isRequesterActionable(reason), "boolean");
  }
});

test("the retry signal is named in the thread", () => {
  const body = renderError({
    issueNumber: 1,
    runId: "run",
    reason: "unexpected-retry",
    consumedUsd: 0.1,
    signal: "summarization_retry_scheduled",
  });
  assert.match(body, /summarization_retry_scheduled/);
});

test("a missing directive report is stated explicitly", () => {
  const body = renderNotice({ issueNumber: 1, runId: "run", kind: "missing-report", items: [] });
  assert.match(body, /No directive report was produced for this run\./);
});

test("the outcome message records the responsible person and time", () => {
  const body = samples().at(-1)?.body ?? "";
  assert.match(body, /merged by @maintainer at 2026-10-26T11:00:00.000Z/);
  assert.match(body, /`finished`/);
});
