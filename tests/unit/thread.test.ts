import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDigest, findStateComment, hasMarker, isAgentResultComment, isInternalComment } from "../../src/agent/thread.js";
import type { Issue, IssueComment } from "../../src/agent/github.js";

const issue: Issue = {
  number: 42,
  title: "Fix login timeout",
  body: "The login times out.",
  user: { login: "reporter", type: "User" },
  state: "open",
  labels: [{ name: "agent:run" }],
  created_at: "2026-10-28T10:00:00Z",
  updated_at: "2026-10-28T10:00:00Z",
  html_url: "https://example.test/42",
};

function comment(id: number, body: string): IssueComment {
  return {
    id,
    body,
    user: { login: "user", type: "User" },
    created_at: "2026-10-28T11:00:00Z",
  };
}

test("finds the state comment", () => {
  const comments = [comment(1, "hello"), comment(2, "<!-- agent-session-state {} -->")];
  assert.equal(findStateComment(comments)?.id, 2);
  assert.equal(findStateComment([comment(1, "hello")]), null);
});

test("marks internal and result comments", () => {
  assert.equal(isInternalComment(comment(1, "<!-- agent-session-state {} -->")), true);
  assert.equal(isAgentResultComment(comment(2, "<!-- agent-run:1 -->")), true);
  assert.equal(isInternalComment(comment(3, "ordinary")), false);
});

test("detects a marker", () => {
  assert.equal(hasMarker([comment(1, "<!-- agent-run:1 -->")], "<!-- agent-run:1 -->"), true);
  assert.equal(hasMarker([comment(1, "other")], "<!-- agent-run:1 -->"), false);
});

test("builds a bounded digest and marks truncation", () => {
  const comments = [comment(1, "short"), comment(2, "x".repeat(600))];
  const digest = buildDigest(issue, comments, { maxComments: 1, maxCommentCharacters: 500 });
  assert.equal(digest.comments.length, 1);
  assert.equal(digest.omittedComments, 1);
  assert.equal(digest.truncatedComments, 1);
  assert.match(digest.comments[0]!.body, /\[truncated 100 characters\]/);
});

test("excludes internal comments from the digest", () => {
  const comments = [
    comment(1, "hello"),
    comment(2, "<!-- agent-session-state {} -->"),
    comment(3, "<!-- agent-run:1 --> result"),
  ];
  const digest = buildDigest(issue, comments, { maxComments: 10, maxCommentCharacters: 1000 });
  assert.equal(digest.comments.length, 1);
  assert.equal(digest.comments[0]!.body, "hello");
});
