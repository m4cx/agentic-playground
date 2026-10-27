import assert from "node:assert/strict";
import test from "node:test";

import { parseIssueTrigger } from "../../src/agent/events.js";
import type { ParsedEventPayload } from "../../src/agent/events.js";
import { fakeWorkspaceState, makeHarness, type Harness } from "../fake-github.js";

function triggerFor(harness: Harness, issueNumber: number) {
  const issue = harness.github.issues.get(issueNumber);
  assert.ok(issue !== undefined);
  const trigger = parseIssueTrigger(
    "issues",
    {
      action: "labeled",
      issue,
      label: { name: "agent:run" },
      sender: { login: "maintainer" },
      repository: { full_name: "example/repo" },
    },
    harness.loaded.config.labels,
  );
  assert.ok(trigger !== null);
  return trigger;
}

type EventPullRequest = NonNullable<ParsedEventPayload["pull_request"]>;

function proposalFor(harness: Harness, issueNumber: number, merged: boolean): EventPullRequest {
  const [pullRequest] = [...harness.github.pullRequests.values()];
  assert.ok(pullRequest !== undefined);
  const labels = [{ name: harness.loaded.config.labels.proposal }];
  return {
    ...pullRequest,
    number: pullRequest.number,
    labels,
    merged,
    merged_by: merged ? { login: "maintainer" } : null,
    merged_at: merged ? "2026-10-26T12:00:00.000Z" : null,
    state: "closed",
    closed_at: "2026-10-26T12:00:00.000Z",
    body: `Closes #${issueNumber}`,
  };
}

test("a run with changes opens a proposal and waits for a human", async () => {
  const harness = makeHarness({
    workspace: fakeWorkspaceState(["CONTRIBUTING.md"]),
    stubEnv: { STUB_PI_TEXT: "Add a contributor guide.\n\nagent-ignored: none\n" },
  });
  harness.github.addIssue({ number: 51, title: "Add a CONTRIBUTING guide", body: "State that we squash-merge.", labels: ["agent:run"] });

  const result = await harness.orchestrator.run(triggerFor(harness, 51));
  assert.equal(result.status, "waiting");
  assert.ok(result.proposalUrl?.includes("/pull/"));

  assert.equal(harness.github.pullRequestInputs.length, 1);
  const input = harness.github.pullRequestInputs[0];
  assert.equal(input?.draft, false);
  assert.match(input?.title ?? "", /\(#51\)$/);
  assert.match(input?.body ?? "", /Closes #51/);

  assert.ok(harness.workspace.commits.length === 1);
  assert.match(harness.workspace.commits[0] ?? "", /^agent: .+ \(#51\)$/);
  assert.equal(harness.workspace.pushedBranches.length, 1);

  assert.deepEqual(harness.github.labelsOf(51).sort(), [
    "agent:proposal",
    "agent:run",
    "agent:waiting",
  ]);
  const resultComment = harness.github.markerComments(51, "result")[0]?.body ?? "";
  assert.match(resultComment, /proposal opened/);
  assert.match(resultComment, /review and merge the proposal/);
});

test("an approving review is recorded as a decision", async () => {
  const harness = makeHarness({ workspace: fakeWorkspaceState(["docs/guide.md"]) });
  harness.github.addIssue({ number: 52, title: "Document the workflow", body: "Write it down.", labels: ["agent:run"] });
  await harness.orchestrator.run(triggerFor(harness, 52));
  const pullRequest = proposalFor(harness, 52, false);

  await harness.orchestrator.handleProposal("pull_request", {
    action: "review",
    pull_request: pullRequest,
    review: {
      id: 9001,
      user: { login: "maintainer" },
      state: "APPROVED",
      body: "Looks good.",
      submitted_at: "2026-10-26T11:00:00.000Z",
    },
    repository: { full_name: "example/repo" },
  });

  const decisions = harness.github.markerComments(52, "decision").map((comment) => comment.body ?? "");
  assert.ok(decisions.some((body) => /Decision recorded: `approve`/.test(body)));
  assert.ok(decisions.some((body) => /Source: review/.test(body)));
});

test("a review from an account without write access is ignored", async () => {
  const harness = makeHarness({ workspace: fakeWorkspaceState(["a.txt"]) });
  harness.github.addIssue({ number: 53, title: "Change something", body: "Do it.", labels: ["agent:run"] });
  await harness.orchestrator.run(triggerFor(harness, 53));
  const pullRequest = proposalFor(harness, 53, false);

  await harness.orchestrator.handleProposal("pull_request", {
    action: "review",
    pull_request: pullRequest,
    review: {
      id: 9002,
      user: { login: "reader" },
      state: "APPROVED",
      body: "Sure.",
      submitted_at: "2026-10-26T11:00:00.000Z",
    },
    repository: { full_name: "example/repo" },
  });

  const decisions = harness.github.markerComments(53, "decision").map((comment) => comment.body ?? "");
  assert.ok(decisions.some((body) => /ignored approve/.test(body)));
});

test("a merged close resolves the issue to finished", async () => {
  const harness = makeHarness({ workspace: fakeWorkspaceState(["a.txt"]) });
  harness.github.addIssue({ number: 54, title: "Change a file", body: "Do it.", labels: ["agent:run"] });
  await harness.orchestrator.run(triggerFor(harness, 54));

  await harness.orchestrator.handleProposal("pull_request", {
    action: "closed",
    pull_request: proposalFor(harness, 54, true),
    sender: { login: "maintainer" },
    repository: { full_name: "example/repo" },
  });

  const outcome = harness.github.markerComments(54, "outcome")[0]?.body ?? "";
  assert.match(outcome, /merged by @maintainer at 2026-10-26T12:00:00\.000Z/);
  assert.match(outcome, /`finished`/);
  assert.deepEqual(harness.github.labelsOf(54).sort(), ["agent:finished", "agent:proposal", "agent:run"]);
  const decisions = harness.github.markerComments(54, "decision").map((comment) => comment.body ?? "");
  assert.ok(decisions.some((body) => /Decision recorded: `merge`/.test(body)));
});

test("a closed-unmerged proposal resolves the issue to rejected", async () => {
  const harness = makeHarness({ workspace: fakeWorkspaceState(["a.txt"]) });
  harness.github.addIssue({ number: 55, title: "Reject this", body: "Do it.", labels: ["agent:run"] });
  await harness.orchestrator.run(triggerFor(harness, 55));

  await harness.orchestrator.handleProposal("pull_request", {
    action: "closed",
    pull_request: proposalFor(harness, 55, false),
    sender: { login: "maintainer" },
    repository: { full_name: "example/repo" },
  });

  const outcome = harness.github.markerComments(55, "outcome")[0]?.body ?? "";
  assert.match(outcome, /closed without merge/);
  assert.match(outcome, /`rejected`/);
  assert.deepEqual(harness.github.labelsOf(55).sort(), ["agent:proposal", "agent:rejected", "agent:run"]);
  assert.match(
    harness.github.commentsFor(55).map((comment) => comment.body ?? "").join("\n"),
    /The change was not applied\./,
  );
});

test("the default branch is never touched before a human merge", async () => {
  const harness = makeHarness({ workspace: fakeWorkspaceState(["a.txt"]) });
  harness.github.addIssue({ number: 56, title: "Safety", body: "Change a file.", labels: ["agent:run"] });
  await harness.orchestrator.run(triggerFor(harness, 56));

  // The only push is to the agent branch; no merge endpoint exists on the client.
  assert.equal(harness.workspace.pushedBranches.length, 1);
  assert.match(harness.workspace.pushedBranches[0] ?? "", /^agent\//);
  assert.equal(
    typeof (harness.github as unknown as { merge?: unknown }).merge,
    "undefined",
  );
  const outcome = harness.github.markerComments(56, "outcome");
  assert.equal(outcome.length, 0, "nothing resolves the proposal without a close event");
});
