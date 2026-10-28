import { test } from "node:test";
import assert from "node:assert/strict";
import { pullRequestTitle, renderPullRequestBody } from "../../src/agent/pr.js";
import { createSession } from "../../src/agent/state.js";
import type { AgentOutput } from "../../src/agent/output.js";

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

const output: AgentOutput = {
  summary: "Implemented the change.",
  verification: ["npm test — passed"],
  openQuestions: [],
  couldNotComplete: [],
  prTitle: "",
  prBody: "",
  state: "finished",
};

test("a missing PR title falls back to an English title", () => {
  assert.equal(pullRequestTitle(session, output), "Agent work for issue #42");
});

test("a validated PR title is used when present", () => {
  assert.equal(pullRequestTitle(session, { ...output, prTitle: "Fix login timeout" }), "Fix login timeout");
});

test("the PR body is always rendered from validated English fields", () => {
  const body = renderPullRequestBody(session, output);
  assert.match(body, /## Agent result for issue #42/);
  assert.match(body, /Implemented the change\./);
  assert.match(body, /Closes #42/);
});
