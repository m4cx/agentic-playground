import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentError } from "../../src/agent/errors.js";
import { handleWork } from "../../src/agent/session.js";
import { parseStateMarker } from "../../src/agent/state.js";
import { FakeGitHub } from "../fake-github.js";
import { FakeWorkspace } from "../fake-workspace.js";
import { FakePi, outputText, defaultOutput } from "../fake-rpc.js";
import { makeDeps, readEvent } from "../session-fixture.js";

test("a timeout fails the session, preserves the WIP commit, and does not retry", async () => {
  const github = new FakeGitHub({ number: 42, title: "Fix login timeout", labels: ["agent:run"] });
  const workspace = new FakeWorkspace("/tmp/workspace-timeout", { hasChanges: true });
  const pi = new FakePi(() => {
    throw new AgentError("timeout", "agent deadline reached");
  });
  const { deps, cleanup } = makeDeps({ github, pi, workspace, runId: "run-timeout" });
  try {
    await assert.rejects(
      () => handleWork({ deps, eventName: "issues", payload: readEvent("issues-labeled.json") }),
      (error: unknown) => (error as { code?: string }).code === "timeout",
    );
    assert.equal(pi.calls.length, 1);
    assert.equal(workspace.commits.at(-1)?.subject, "agent: work in progress on issue #42");
    assert.equal(workspace.pushes[0], "feature/42-fix-login-timeout");
    const state = parseStateMarker(github.stateComment()!.body)!;
    assert.equal(state.session.state, "failed");
    assert.equal(state.session.lastFailure?.reason, "timeout");
    assert.match(github.comments.find((comment) => comment.body.includes("Agent run failed"))!.body, /timeout/);
  } finally {
    cleanup();
  }
});

test("missing structured output fails with agent-output", async () => {
  const github = new FakeGitHub({ number: 42, title: "Fix login timeout", labels: ["agent:run"] });
  const workspace = new FakeWorkspace("/tmp/workspace-output");
  const pi = new FakePi(() => ({ text: "I did the work but forgot the JSON.", stats: null }));
  const { deps, cleanup } = makeDeps({ github, pi, workspace, runId: "run-output" });
  try {
    await assert.rejects(
      () => handleWork({ deps, eventName: "issues", payload: readEvent("issues-labeled.json") }),
      (error: unknown) => (error as { code?: string }).code === "agent-output",
    );
    const state = parseStateMarker(github.stateComment()!.body)!;
    assert.equal(state.session.state, "failed");
    assert.equal(state.session.lastFailure?.reason, "agent-output");
  } finally {
    cleanup();
  }
});

test("an automatic retry signal fails with unexpected-retry", async () => {
  const github = new FakeGitHub({ number: 42, title: "Fix login timeout", labels: ["agent:run"] });
  const workspace = new FakeWorkspace("/tmp/workspace-retry");
  const pi = new FakePi(() => {
    throw new AgentError("unexpected-retry", "Pi reported an automatic retry");
  });
  const { deps, cleanup } = makeDeps({ github, pi, workspace, runId: "run-retry" });
  try {
    await assert.rejects(
      () => handleWork({ deps, eventName: "issues", payload: readEvent("issues-labeled.json") }),
      /automatic retry/,
    );
    assert.equal(parseStateMarker(github.stateComment()!.body)!.session.state, "failed");
  } finally {
    cleanup();
  }
});

test("a waiting result keeps the session open with a question", async () => {
  const github = new FakeGitHub({ number: 42, title: "Fix login timeout", labels: ["agent:run"] });
  const workspace = new FakeWorkspace("/tmp/workspace-waiting");
  const pi = new FakePi(() => ({
    text: outputText(
      defaultOutput({
        state: "waiting",
        openQuestions: ["Should the timeout be configurable per user?"],
      }),
    ),
    stats: null,
  }));
  const { deps, cleanup } = makeDeps({ github, pi, workspace, runId: "run-waiting" });
  try {
    await handleWork({ deps, eventName: "issues", payload: readEvent("issues-labeled.json") });
    const state = parseStateMarker(github.stateComment()!.body)!;
    assert.equal(state.session.state, "waiting");
    assert.match(github.resultComments()[0]!.body, /Should the timeout be configurable/);
  } finally {
    cleanup();
  }
});

test("a secret in the agent's files fails the run without committing", async () => {
  const github = new FakeGitHub({ number: 42, title: "Fix login timeout", labels: ["agent:run"] });
  const workspace = new FakeWorkspace("/tmp/workspace-secret", {
    hasChanges: true,
    leakedSecrets: ["src/leak.ts"],
  });
  const pi = new FakePi(() => ({ text: outputText(defaultOutput()), stats: null }));
  const { deps, cleanup } = makeDeps({ github, pi, workspace, runId: "run-secret" });
  try {
    await assert.rejects(
      () => handleWork({ deps, eventName: "issues", payload: readEvent("issues-labeled.json") }),
      (error: unknown) => (error as { code?: string }).code === "redaction",
    );
    assert.equal(workspace.commits.length, 0);
    assert.equal(workspace.pushes.length, 0);
    const state = parseStateMarker(github.stateComment()!.body)!;
    assert.equal(state.session.state, "failed");
    assert.equal(state.session.lastFailure?.reason, "redaction");
  } finally {
    cleanup();
  }
});
