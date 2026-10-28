import { test } from "node:test";
import assert from "node:assert/strict";
import { handleWork } from "../../src/agent/session.js";
import { parseStateMarker } from "../../src/agent/state.js";
import { FakeGitHub } from "../fake-github.js";
import { FakeWorkspace } from "../fake-workspace.js";
import { FakePi, defaultOutput, outputText } from "../fake-rpc.js";
import { makeDeps, readEvent } from "../session-fixture.js";

test("a labeled issue produces an acknowledgement, branch, pull request, and result", async () => {
  const github = new FakeGitHub({ number: 42, title: "Fix login timeout", labels: ["agent:run"] });
  const workspace = new FakeWorkspace("/tmp/workspace-run", { hasChanges: true });
  const pi = new FakePi(() => ({ text: outputText(defaultOutput()), stats: null }));
  const { deps, cleanup } = makeDeps({ github, pi, workspace, runId: "run-1" });
  try {
    await handleWork({ deps, eventName: "issues", payload: readEvent("issues-labeled.json") });

    assert.deepEqual(github.removedLabels, ["agent:run"]);
    assert.equal(github.comments.some((comment) => comment.body.includes("agent-ack:run-1")), true);
    assert.equal(github.resultComments().length, 1);
    assert.equal(github.pullRequests.length, 1);
    assert.equal(workspace.pushes[0], "feature/42-fix-login-timeout");
    assert.equal(workspace.commits[0]?.subject, "agent: work on issue #42");

    const state = parseStateMarker(github.stateComment()!.body)!;
    assert.equal(state.session.state, "finished");
    assert.equal(state.session.branchName, "feature/42-fix-login-timeout");
    assert.equal(state.session.pullRequestNumber, 1);
    assert.equal(state.session.headSha, "commit-sha");
    assert.equal(state.session.runs.length, 1);
    assert.equal(state.session.runs[0]?.outcome, "finished");
  } finally {
    cleanup();
  }
});

test("a no-change result still creates one empty commit and a pull request", async () => {
  const github = new FakeGitHub({ number: 43, title: "Explain the timeout", labels: ["agent:run"] });
  const workspace = new FakeWorkspace("/tmp/workspace-empty", { hasChanges: false });
  const pi = new FakePi(() => ({
    text: outputText(
      defaultOutput({
        summary: "The timeout is already documented; no code change was needed.",
        verification: [],
      }),
    ),
    stats: null,
  }));
  const { deps, cleanup } = makeDeps({ github, pi, workspace, runId: "run-2" });
  try {
    await handleWork({
      deps,
      eventName: "issues",
      payload: {
        ...readEvent("issues-labeled.json"),
        issue: { number: 43, title: "Explain the timeout", state: "open", labels: [] },
      },
    });

    assert.equal(workspace.emptyCommits.length, 1);
    assert.equal(workspace.commits.length, 0);
    assert.equal(github.pullRequests.length, 1);
    const state = parseStateMarker(github.stateComment()!.body)!;
    assert.equal(state.session.state, "finished");
    assert.equal(state.session.headSha, "empty-sha");
  } finally {
    cleanup();
  }
});

test("the default branch is never pushed", async () => {
  const github = new FakeGitHub({ number: 44, title: "Add a health check", labels: ["agent:run"] });
  const workspace = new FakeWorkspace("/tmp/workspace-default", { hasChanges: true });
  const pi = new FakePi(() => ({ text: outputText(defaultOutput()), stats: null }));
  const { deps, cleanup } = makeDeps({ github, pi, workspace, runId: "run-3" });
  try {
    await handleWork({
      deps,
      eventName: "issues",
      payload: {
        ...readEvent("issues-labeled.json"),
        issue: { number: 44, title: "Add a health check", state: "open", labels: [] },
      },
    });
    assert.deepEqual(workspace.pushes, ["feature/44-add-a-health-check"]);
  } finally {
    cleanup();
  }
});

test("a missing state marker is recovered from one existing feature branch", async () => {
  const github = new FakeGitHub({ number: 42, title: "Fix login timeout", labels: ["agent:run"] });
  github.branches.set("feature/42-recovered-work", {
    name: "feature/42-recovered-work",
    commit: { sha: "existing-sha" },
  });
  const workspace = new FakeWorkspace("/tmp/workspace-recovery-run", { hasChanges: true });
  const pi = new FakePi(() => ({ text: outputText(defaultOutput()), stats: null }));
  const { deps, cleanup } = makeDeps({ github, pi, workspace, runId: "run-recovery" });
  try {
    await handleWork({ deps, eventName: "issues", payload: readEvent("issues-labeled.json") });
    const state = parseStateMarker(github.stateComment()!.body)!;
    assert.equal(state.session.branchName, "feature/42-recovered-work");
    assert.equal(workspace.prepareCalls[0]?.resume, true);
    assert.equal(
      github.comments.some((comment) => comment.body.includes("Agent session state recovered")),
      true,
    );
  } finally {
    cleanup();
  }
});

test("two matching branches fail with state-recovery instead of guessing", async () => {
  const github = new FakeGitHub({ number: 42, title: "Fix login timeout", labels: ["agent:run"] });
  github.branches.set("feature/42-one", { name: "feature/42-one", commit: { sha: "a" } });
  github.branches.set("feature/42-two", { name: "feature/42-two", commit: { sha: "b" } });
  const workspace = new FakeWorkspace("/tmp/workspace-ambiguous");
  const pi = new FakePi(() => ({ text: outputText(defaultOutput()), stats: null }));
  const { deps, cleanup } = makeDeps({ github, pi, workspace, runId: "run-ambiguous" });
  try {
    await assert.rejects(
      () => handleWork({ deps, eventName: "issues", payload: readEvent("issues-labeled.json") }),
      (error: unknown) => (error as { code?: string }).code === "state-recovery",
    );
  } finally {
    cleanup();
  }
});
