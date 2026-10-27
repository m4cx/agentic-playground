import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseIssueTrigger } from "../../src/agent/events.js";
import { renderStatus } from "../../src/agent/messages.js";
import { fakeWorkspaceState, makeHarness, stubLogPath } from "../fake-github.js";

function labelledTrigger(harness: ReturnType<typeof makeHarness>, issueNumber: number) {
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

test("trigger → acknowledgement → turn → result → terminal state", async () => {
  const harness = makeHarness({
    workspace: fakeWorkspaceState([]),
    stubEnv: { STUB_PI_TURNS: "2", STUB_PI_TEXT: "I answered the question.\n\nagent-ignored: none\n" },
  });
  const issue = harness.github.addIssue({
    number: 11,
    title: "Explain the build",
    body: "How do I build this project?",
    labels: ["agent:run"],
  });

  const result = await harness.orchestrator.run(labelledTrigger(harness, 11));
  assert.equal(result.status, "finished");
  assert.equal(result.failureReason, undefined);

  const kinds = harness.github.commentsFor(11).map((comment) => (comment.body ?? "").split("\n")[0]);
  assert.ok(kinds[0]?.includes("agent:ack"), `ack must be first, got ${kinds[0] ?? "nothing"}`);
  assert.ok(kinds.some((line) => line?.includes("agent:status")));
  assert.ok(kinds.some((line) => line?.includes("agent:result")));
  assert.ok(kinds.some((line) => line?.includes("agent:session")));

  // Exactly one acknowledgement, one result, and one status comment.
  assert.equal(harness.github.markerComments(11, "ack").length, 1);
  assert.equal(harness.github.markerComments(11, "result").length, 1);
  assert.equal(harness.github.markerComments(11, "status").length, 1);

  // The single status comment accumulated rows instead of being duplicated.
  const status = harness.github.markerComments(11, "status")[0]?.body ?? "";
  assert.match(status, /`queued`/);
  assert.match(status, /`working`/);
  assert.match(status, /`finished`/);

  assert.deepEqual(harness.github.labelsOf(11).sort(), ["agent:finished", "agent:run"]);
  const ack = harness.github.markerComments(11, "ack")[0]?.body ?? "";
  assert.match(ack, /queue delay/);
  assert.match(ack, /configuration fingerprint/);
  assert.match(ack, /Pi `1\.4\.0`/);

  // The stub never saw a repository credential.
  const log = readFileSync(stubLogPath(harness), "utf8");
  const start = log.split("\n")[0] ?? "";
  assert.match(start, /"hasGithubToken":false/);
  assert.equal(issue.number, 11);
});

test("a second trigger on a non-terminal issue does not start a second run", async () => {
  const harness = makeHarness();
  harness.github.addIssue({ number: 12, title: "Long task", body: "Do the thing", labels: [] });
  // Seed the issue as already running, with an append-only status row.
  await harness.github.addLabels(12, ["agent:run", "agent:working"]);
  const status = renderStatus({
    issueNumber: 12,
    runId: "run-earlier",
    state: "working",
    stateMeaning: "a run is active.",
    startedAt: "2026-10-26T10:00:00.000Z",
    consumedUsd: 0.1,
    capUsd: 5,
    turns: 1,
    proposalUrl: null,
    nextAct: "none",
    rows: [
      { at: "2026-10-26T10:00:00.000Z", state: "working", runId: "run-earlier", consumed: "$0.10", nextAct: "none" },
    ],
    notes: [],
  });
  harness.github.addComment(12, { login: "agent", body: status });

  const result = await harness.orchestrator.run(labelledTrigger(harness, 12));
  assert.equal(result.status, "duplicate");
  assert.equal(harness.github.markerComments(12, "ack").length, 0);
  const statusAfter = harness.github.markerComments(12, "status")[0]?.body ?? "";
  assert.match(statusAfter, /duplicate request label event/);
});

test("a request edited mid-run stops at the boundary and restates both versions", async () => {
  const harness = makeHarness({
    stubEnv: { STUB_PI_TURNS: "4", STUB_PI_TURN_DELAY_MS: "10" },
  });
  harness.github.addIssue({
    number: 13,
    title: "Write the guide",
    body: "Draft a guide.",
    labels: ["agent:run"],
  });

  // The fourth issue read is the first boundary check in the run.
  harness.github.onGetIssue = (issue, callCount) => {
    if (callCount === 4) {
      harness.github.updateIssue(issue.number, {
        body: "Draft a guide, and also rewrite the README.",
        updated_at: new Date(Date.now() + 1000).toISOString(),
      });
    }
  };

  const result = await harness.orchestrator.run(labelledTrigger(harness, 13));
  assert.equal(result.status, "waiting");

  const feedback = harness.github.markerComments(13, "feedback")[0]?.body ?? "";
  assert.match(feedback, /Request changed during the run/);
  assert.match(feedback, /Acted on:/);
  assert.match(feedback, /Found now:/);
  assert.match(feedback, /\/agent continue/);
  assert.deepEqual(harness.github.labelsOf(13).sort(), ["agent:run", "agent:waiting"]);
  assert.equal(harness.github.markerComments(13, "result").length, 0);

  // The run was aborted instead of continuing on the stale request.
  const log = readFileSync(stubLogPath(harness), "utf8");
  const commands = log
    .split("\n")
    .filter((line) => line.includes('"type":"command"'))
    .map((line) => (JSON.parse(line) as { command: { type: string } }).command.type);
  assert.ok(commands.includes("abort"));
  assert.equal(commands.includes("steer"), false);
  assert.equal(commands.includes("follow_up"), false);
});

test("a configured template that did not load fails the run before any prompt", async () => {
  const harness = makeHarness({
    stubEnv: { STUB_PI_COMMANDS: "speckit.specify", STUB_PI_TURNS: "1" },
  });
  harness.github.addIssue({
    number: 14,
    title: "Template check",
    body: "Do something.",
    labels: ["agent:run"],
  });

  const result = await harness.orchestrator.run(labelledTrigger(harness, 14));
  assert.equal(result.status, "failed");

  const error = harness.github.markerComments(14, "error")[0]?.body ?? "";
  assert.match(error, /`environment`/);
  assert.match(error, /did not load as \/speckit\.plan/);

  const log = readFileSync(stubLogPath(harness), "utf8");
  assert.equal(log.includes('"type":"prompt"'), false, "no model call may happen");
});

test("a non-root orchestrator with an egress uid fails before the acknowledgement", async () => {
  const harness = makeHarness({ env: { AGENT_EGRESS_UID: "1500" }, getuid: () => 1001 });
  harness.github.addIssue({
    number: 16,
    title: "Privilege check",
    body: "Do something.",
    labels: ["agent:run"],
  });

  const result = await harness.orchestrator.run(labelledTrigger(harness, 16));
  assert.equal(result.status, "failed");
  assert.equal(result.failureReason, "environment");
  assert.equal(harness.github.markerComments(16, "ack").length, 0);
  const error = harness.github.markerComments(16, "error")[0]?.body ?? "";
  assert.match(error, /not uid 0/);
  assert.match(error, /sudo/);
});

test("a fresh session is reported as a cold start in the acknowledgement", async () => {
  const harness = makeHarness({ stubEnv: { STUB_PI_TURNS: "1" } });
  harness.github.addIssue({
    number: 15,
    title: "Cold start",
    body: "Say hello.",
    labels: ["agent:run"],
  });
  await harness.orchestrator.run(labelledTrigger(harness, 15));
  const ack = harness.github.markerComments(15, "ack")[0]?.body ?? "";
  assert.match(ack, /Continuity: cold start \(no session was restored\)/);
});
