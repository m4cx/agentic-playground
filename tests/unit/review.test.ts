import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReviewOutcome } from "../../src/agent/events.js";
import { handleReview } from "../../src/agent/review.js";
import { createSession, createStateRecord, parseStateMarker } from "../../src/agent/state.js";
import { renderStateComment } from "../../src/agent/messages.js";
import { FakeGitHub } from "../fake-github.js";

const trigger = {
  kind: "label" as const,
  actor: "maintainer",
  permission: "write" as const,
  at: "2026-10-28T10:00:00Z",
  commentId: null,
  commandText: null,
  labelName: "agent:run",
};

function seedSession(github: FakeGitHub, state: "working" | "finished" | "stopped") {
  const session = createSession({
    issueNumber: 42,
    title: "Fix login timeout",
    trigger,
    now: "2026-10-28T10:00:00Z",
    slugMaxLength: 50,
    fingerprint: "a1b2c3d4",
    requestVersion: "sha256:abc",
  });
  session.state = state;
  session.pullRequestNumber = 7;
  const record = createStateRecord(session, "run-1");
  github.comments.push({
    id: 5000,
    body: renderStateComment(record),
    user: { login: "github-actions[bot]", type: "Bot" },
    created_at: "2026-10-28T10:00:00Z",
  });
  return record;
}

test("parses a merged pull request outcome", () => {
  const outcome = parseReviewOutcome("pull_request", {
    action: "closed",
    pull_request: {
      number: 7,
      html_url: "https://example.test/7",
      state: "closed",
      merged: true,
      merged_by: { login: "maintainer" },
      merged_at: "2026-10-28T13:00:00Z",
      head: { ref: "feature/42-fix-login-timeout", sha: "abc", repo: null },
      base: { ref: "main" },
      body: "Closes #42",
      title: "Fix",
    },
    sender: { login: "maintainer" },
  });
  assert.equal(outcome?.issueNumber, 42);
  assert.equal(outcome?.merged, true);
});

test("parses an unmerged pull request outcome", () => {
  const outcome = parseReviewOutcome("pull_request", {
    action: "closed",
    pull_request: {
      number: 7,
      html_url: "https://example.test/7",
      state: "closed",
      merged: false,
      merged_by: null,
      merged_at: null,
      head: { ref: "feature/42-fix-login-timeout", sha: "abc", repo: null },
      base: { ref: "main" },
      body: "Closes #42",
      title: "Fix",
    },
    sender: { login: "maintainer" },
  });
  assert.equal(outcome?.merged, false);
});

test("parses an issue closed outcome", () => {
  const outcome = parseReviewOutcome("issues", {
    action: "closed",
    issue: { number: 42, state: "closed" },
    sender: { login: "maintainer" },
  });
  assert.equal(outcome?.kind, "issue");
  assert.equal(outcome?.issueNumber, 42);
});

test("a merge moves the session to finished and posts one outcome", async () => {
  const github = new FakeGitHub({ number: 42, title: "Fix login timeout", state: "open" });
  seedSession(github, "working");
  const outcome = parseReviewOutcome("pull_request", {
    action: "closed",
    pull_request: {
      number: 7,
      html_url: "https://example.test/7",
      state: "closed",
      merged: true,
      merged_by: { login: "maintainer" },
      merged_at: "2026-10-28T13:00:00Z",
      head: { ref: "feature/42-fix-login-timeout", sha: "abc", repo: null },
      base: { ref: "main" },
      body: "Closes #42",
      title: "Fix",
    },
    sender: { login: "maintainer" },
  })!;
  await handleReview({
    client: github,
    owner: "owner",
    repo: "repo",
    outcome,
    now: "2026-10-28T13:00:00Z",
  });
  const state = parseStateMarker(github.stateComment()!.body)!;
  assert.equal(state.session.state, "finished");
  assert.equal(github.comments.filter((comment) => comment.body.includes("agent-outcome")).length, 1);

  await handleReview({
    client: github,
    owner: "owner",
    repo: "repo",
    outcome,
    now: "2026-10-28T13:00:00Z",
  });
  assert.equal(github.comments.filter((comment) => comment.body.includes("agent-outcome")).length, 1);
});

test("an unmerged close moves the session to stopped", async () => {
  const github = new FakeGitHub({ number: 42, title: "Fix login timeout", state: "open" });
  seedSession(github, "working");
  const outcome = parseReviewOutcome("pull_request", {
    action: "closed",
    pull_request: {
      number: 7,
      html_url: "https://example.test/7",
      state: "closed",
      merged: false,
      merged_by: null,
      merged_at: null,
      head: { ref: "feature/42-fix-login-timeout", sha: "abc", repo: null },
      base: { ref: "main" },
      body: "Closes #42",
      title: "Fix",
    },
    sender: { login: "maintainer" },
  })!;
  await handleReview({
    client: github,
    owner: "owner",
    repo: "repo",
    outcome,
    now: "2026-10-28T13:00:00Z",
  });
  assert.equal(parseStateMarker(github.stateComment()!.body)!.session.state, "stopped");
});

test("closing the issue does not overwrite a finished merge", async () => {
  const github = new FakeGitHub({ number: 42, title: "Fix login timeout", state: "closed" });
  seedSession(github, "finished");
  const outcome = parseReviewOutcome("issues", {
    action: "closed",
    issue: { number: 42, state: "closed" },
    sender: { login: "maintainer" },
  })!;
  await handleReview({
    client: github,
    owner: "owner",
    repo: "repo",
    outcome,
    now: "2026-10-28T13:00:00Z",
  });
  assert.equal(parseStateMarker(github.stateComment()!.body)!.session.state, "finished");
});
