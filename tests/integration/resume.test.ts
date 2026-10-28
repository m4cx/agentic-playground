import { test } from "node:test";
import assert from "node:assert/strict";
import { handleWork } from "../../src/agent/session.js";
import { parseStateMarker } from "../../src/agent/state.js";
import { FakeGitHub } from "../fake-github.js";
import { FakeWorkspace } from "../fake-workspace.js";
import { FakePi, defaultOutput, outputText } from "../fake-rpc.js";
import { makeDeps, readEvent, seedSession } from "../session-fixture.js";

test("a resume command continues the same session and branch", async () => {
  const github = new FakeGitHub({
    number: 42,
    title: "Fix login timeout",
    state: "open",
    labels: ["agent:run"],
  });
  seedSession(github, "finished");
  const workspace = new FakeWorkspace("/tmp/workspace-resume", { hasChanges: true });
  const pi = new FakePi(() => ({
    text: outputText(defaultOutput({ summary: "Added the regression test." })),
    stats: null,
  }));
  const { deps, cleanup } = makeDeps({ github, pi, workspace, runId: "run-resume" });
  try {
    await handleWork({
      deps,
      eventName: "issue_comment",
      payload: readEvent("issue-comment-resume.json"),
    });

    assert.equal(workspace.prepareCalls[0]?.resume, true);
    assert.equal(workspace.prepareCalls[0]?.branch, "feature/42-fix-login-timeout");
    assert.equal(workspace.pushes[0], "feature/42-fix-login-timeout");
    assert.equal(pi.calls.length, 1);
    assert.match(pi.calls[0]!.prompt, /Add a regression test for the cookie path/);

    const state = parseStateMarker(github.stateComment()!.body)!;
    assert.equal(state.session.id, "issue-42");
    assert.equal(state.session.branchName, "feature/42-fix-login-timeout");
    assert.equal(state.session.runs.length, 2);
    assert.equal(github.comments.filter((comment) => comment.body.includes("agent-session-state")).length, 1);
  } finally {
    cleanup();
  }
});

test("an ordinary comment does not start work", async () => {
  const github = new FakeGitHub({ number: 42, title: "Fix login timeout", state: "open" });
  seedSession(github, "finished");
  const workspace = new FakeWorkspace("/tmp/workspace-ordinary");
  const pi = new FakePi(() => ({ text: outputText(defaultOutput()), stats: null }));
  const { deps, cleanup } = makeDeps({ github, pi, workspace, runId: "run-ordinary" });
  try {
    await handleWork({
      deps,
      eventName: "issue_comment",
      payload: {
        action: "created",
        issue: { number: 42, state: "open" },
        comment: { id: 9002, body: "Thanks, looks good!", user: { login: "maintainer", type: "User" } },
        sender: { login: "maintainer" },
      },
    });
    assert.equal(pi.calls.length, 0);
    assert.equal(workspace.prepareCalls.length, 0);
  } finally {
    cleanup();
  }
});

test("a duplicate resume comment is processed once", async () => {
  const github = new FakeGitHub({ number: 42, title: "Fix login timeout", state: "open" });
  seedSession(github, "finished");
  const workspace = new FakeWorkspace("/tmp/workspace-duplicate");
  const pi = new FakePi(() => ({ text: outputText(defaultOutput()), stats: null }));
  const { deps, cleanup } = makeDeps({ github, pi, workspace, runId: "run-duplicate" });
  const payload = readEvent("issue-comment-resume.json");
  try {
    await handleWork({ deps, eventName: "issue_comment", payload });
    await handleWork({ deps, eventName: "issue_comment", payload });
    assert.equal(pi.calls.length, 1);
  } finally {
    cleanup();
  }
});

test("an unauthorized resume is ignored with an explanation", async () => {
  const github = new FakeGitHub({ number: 42, title: "Fix login timeout", state: "open" });
  seedSession(github, "finished");
  github.permissions.set("reader", "read");
  const workspace = new FakeWorkspace("/tmp/workspace-unauthorized");
  const pi = new FakePi(() => ({ text: outputText(defaultOutput()), stats: null }));
  const { deps, cleanup } = makeDeps({ github, pi, workspace, runId: "run-unauthorized" });
  try {
    await handleWork({
      deps,
      eventName: "issue_comment",
      payload: {
        ...readEvent("issue-comment-resume.json"),
        sender: { login: "reader", type: "User" },
        comment: {
          id: 9003,
          body: "/agent continue Please continue",
          user: { login: "reader", type: "User" },
        },
      },
    });
    assert.equal(pi.calls.length, 0);
    assert.equal(github.noticeComments().length, 1);
    assert.match(github.noticeComments()[0]!.body, /write access/);
  } finally {
    cleanup();
  }
});

test("a closed issue does not resume", async () => {
  const github = new FakeGitHub({ number: 42, title: "Fix login timeout", state: "closed" });
  seedSession(github, "stopped");
  const workspace = new FakeWorkspace("/tmp/workspace-closed");
  const pi = new FakePi(() => ({ text: outputText(defaultOutput()), stats: null }));
  const { deps, cleanup } = makeDeps({ github, pi, workspace, runId: "run-closed" });
  try {
    await handleWork({
      deps,
      eventName: "issue_comment",
      payload: {
        ...readEvent("issue-comment-resume.json"),
        issue: { number: 42, state: "closed" },
      },
    });
    assert.equal(pi.calls.length, 0);
  } finally {
    cleanup();
  }
});

test("a missing feature branch is recreated and reported", async () => {
  const github = new FakeGitHub({ number: 42, title: "Fix login timeout", state: "open" });
  seedSession(github, "finished");
  const workspace = new FakeWorkspace("/tmp/workspace-recover", { branchMissing: true });
  const pi = new FakePi(() => ({ text: outputText(defaultOutput()), stats: null }));
  const { deps, cleanup } = makeDeps({ github, pi, workspace, runId: "run-recover" });
  const payload = {
    ...readEvent("issue-comment-resume.json"),
    comment: {
      id: 9010,
      body: "/agent continue Please rebuild the branch",
      user: { login: "maintainer", type: "User" },
    },
  };
  try {
    await handleWork({ deps, eventName: "issue_comment", payload });
    assert.equal(
      github.comments.some((comment) => comment.body.includes("Agent session state recovered")),
      true,
    );
  } finally {
    cleanup();
  }
});
