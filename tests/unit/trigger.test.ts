import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTrigger, toTrigger, matchesResumeCommand, resumeCommandText } from "../../src/agent/trigger.js";

const config = { triggerLabel: "agent:run", resumeCommand: "/agent continue" };

test("parses an accepted label trigger", () => {
  const trigger = parseTrigger(
    "issues",
    {
      action: "labeled",
      issue: { number: 42, state: "open", labels: [] },
      label: { name: "agent:run" },
      sender: { login: "maintainer" },
    },
    config,
  );
  assert.equal(trigger?.kind, "label");
  assert.equal(trigger?.issueNumber, 42);
  assert.equal(trigger?.actor, "maintainer");
});

test("ignores a stale or different label", () => {
  const trigger = parseTrigger(
    "issues",
    {
      action: "labeled",
      issue: { number: 42, state: "open" },
      label: { name: "other" },
      sender: { login: "maintainer" },
    },
    config,
  );
  assert.equal(trigger, null);
});

test("ignores a label on a closed issue", () => {
  const trigger = parseTrigger(
    "issues",
    {
      action: "labeled",
      issue: { number: 42, state: "closed" },
      label: { name: "agent:run" },
      sender: { login: "maintainer" },
    },
    config,
  );
  assert.equal(trigger, null);
});

test("parses a resume command and keeps the follow-up text", () => {
  const trigger = parseTrigger(
    "issue_comment",
    {
      action: "created",
      issue: { number: 42, state: "open" },
      comment: {
        id: 9001,
        body: "/agent continue Add a test",
        user: { login: "maintainer", type: "User" },
        created_at: "2026-10-28T12:00:00Z",
      },
      sender: { login: "maintainer" },
    },
    config,
  );
  assert.equal(trigger?.kind, "resume-command");
  assert.equal(trigger?.commentId, 9001);
  assert.equal(trigger?.commandText, "Add a test");
});

test("ignores a command that is not on the first line", () => {
  assert.equal(matchesResumeCommand("hello\n/agent continue", config.resumeCommand), false);
});

test("ignores a command with a non-word suffix", () => {
  assert.equal(matchesResumeCommand("/agent continues", config.resumeCommand), false);
});

test("accepts a bare command", () => {
  assert.equal(matchesResumeCommand("/agent continue", config.resumeCommand), true);
  assert.equal(resumeCommandText("/agent continue", config.resumeCommand), "");
});

test("ignores comments on pull requests", () => {
  const trigger = parseTrigger(
    "issue_comment",
    {
      action: "created",
      issue: { number: 42, state: "open", pull_request: {} },
      comment: { id: 1, body: "/agent continue", user: { login: "maintainer", type: "User" } },
      sender: { login: "maintainer" },
    },
    config,
  );
  assert.equal(trigger, null);
});

test("ignores bot comments", () => {
  const trigger = parseTrigger(
    "issue_comment",
    {
      action: "created",
      issue: { number: 42, state: "open" },
      comment: {
        id: 1,
        body: "/agent continue",
        user: { login: "github-actions[bot]", type: "Bot" },
      },
      sender: { login: "github-actions[bot]" },
    },
    config,
  );
  assert.equal(trigger, null);
});

test("converts a candidate to a trigger with permission", () => {
  const candidate = {
    kind: "label" as const,
    actor: "maintainer",
    at: "2026-10-28T10:00:00Z",
    issueNumber: 42,
    commentId: null,
    commandText: null,
    labelName: "agent:run",
  };
  const trigger = toTrigger(candidate, "write");
  assert.equal(trigger.permission, "write");
  assert.equal(trigger.kind, "label");
});
