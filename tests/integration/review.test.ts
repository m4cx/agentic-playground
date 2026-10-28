import { test } from "node:test";
import assert from "node:assert/strict";
import { handleReview } from "../../src/agent/review.js";
import { parseReviewOutcome } from "../../src/agent/events.js";
import { parseStateMarker } from "../../src/agent/state.js";
import { FakeGitHub } from "../fake-github.js";
import { readEvent, seedSession } from "../session-fixture.js";

test("a merged pull request finishes the session and records the actor", async () => {
  const github = new FakeGitHub({ number: 42, title: "Fix login timeout", state: "open" });
  seedSession(github, "working");
  const outcome = parseReviewOutcome("pull_request", readEvent("pull-request-merged.json"))!;
  await handleReview({
    client: github,
    owner: "owner",
    repo: "repo",
    outcome,
    now: "2026-10-28T13:00:00Z",
  });
  assert.equal(parseStateMarker(github.stateComment()!.body)!.session.state, "finished");
  assert.equal(github.comments.filter((comment) => comment.body.includes("agent-outcome")).length, 1);
});

test("a pull request closed without merge stops the session", async () => {
  const github = new FakeGitHub({ number: 42, title: "Fix login timeout", state: "open" });
  seedSession(github, "working");
  const outcome = parseReviewOutcome("pull_request", readEvent("pull-request-closed.json"))!;
  await handleReview({
    client: github,
    owner: "owner",
    repo: "repo",
    outcome,
    now: "2026-10-28T13:00:00Z",
  });
  assert.equal(parseStateMarker(github.stateComment()!.body)!.session.state, "stopped");
});

test("closing the issue stops the session", async () => {
  const github = new FakeGitHub({ number: 42, title: "Fix login timeout", state: "closed" });
  seedSession(github, "working");
  const outcome = parseReviewOutcome("issues", readEvent("issue-closed.json"))!;
  await handleReview({
    client: github,
    owner: "owner",
    repo: "repo",
    outcome,
    now: "2026-10-28T13:00:00Z",
  });
  assert.equal(parseStateMarker(github.stateComment()!.body)!.session.state, "stopped");
});

test("a replayed review event does not duplicate the outcome comment", async () => {
  const github = new FakeGitHub({ number: 42, title: "Fix login timeout", state: "open" });
  seedSession(github, "working");
  const outcome = parseReviewOutcome("pull_request", readEvent("pull-request-merged.json"))!;
  await handleReview({ client: github, owner: "owner", repo: "repo", outcome, now: "2026-10-28T13:00:00Z" });
  await handleReview({ client: github, owner: "owner", repo: "repo", outcome, now: "2026-10-28T13:01:00Z" });
  assert.equal(github.comments.filter((comment) => comment.body.includes("agent-outcome")).length, 1);
});

test("a pull request from a different branch does not change the session", async () => {
  const github = new FakeGitHub({ number: 42, title: "Fix login timeout", state: "open" });
  seedSession(github, "working");
  const outcome = parseReviewOutcome("pull_request", {
    action: "closed",
    pull_request: {
      number: 7,
      html_url: "https://example.test/7",
      state: "closed",
      merged: true,
      merged_by: { login: "attacker" },
      merged_at: "2026-10-28T13:00:00Z",
      head: { ref: "feature/42-unrelated", sha: "abc", repo: null },
      base: { ref: "main" },
      body: "Closes #42",
      title: "Unrelated",
    },
    sender: { login: "attacker" },
  })!;
  await handleReview({ client: github, owner: "owner", repo: "repo", outcome, now: "2026-10-28T13:00:00Z" });
  assert.equal(parseStateMarker(github.stateComment()!.body)!.session.state, "working");
  assert.equal(github.comments.filter((comment) => comment.body.includes("agent-outcome")).length, 0);
});

test("issue closed after a merge resolves to finished using the pull request state", async () => {
  const github = new FakeGitHub({ number: 42, title: "Fix login timeout", state: "closed" });
  seedSession(github, "working");
  github.pullRequests.push({
    number: 7,
    html_url: "https://example.test/7",
    state: "closed",
    merged: true,
    merged_by: { login: "maintainer" },
    merged_at: "2026-10-28T13:00:00Z",
    head: { ref: "feature/42-fix-login-timeout", sha: "abc", repo: { name: "repo", owner: { login: "owner" } } },
    base: { ref: "main" },
    body: "Closes #42",
    title: "Fix",
  });
  const outcome = parseReviewOutcome("issues", readEvent("issue-closed.json"))!;
  await handleReview({ client: github, owner: "owner", repo: "repo", outcome, now: "2026-10-28T13:00:00Z" });
  assert.equal(parseStateMarker(github.stateComment()!.body)!.session.state, "finished");
  assert.match(
    github.comments.find((comment) => comment.body.includes("agent-outcome"))!.body,
    /was merged by/,
  );
});
