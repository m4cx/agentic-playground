import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../../src/agent/config.js";
import { planReconciliation, summarizeActions } from "../../src/agent/reconcile.js";

const labels = loadConfig(process.cwd()).config.labels;
const NOW = Date.parse("2026-10-26T12:00:00.000Z");

function base(overrides: Partial<Parameters<typeof planReconciliation>[0]> = {}) {
  return planReconciliation({
    issueNumber: 7,
    presentLabels: [labels.request, labels.working],
    logState: "working",
    workingSince: "2026-10-26T11:00:00.000Z",
    activeJob: false,
    nowMs: NOW,
    graceMinutes: 30,
    labels,
    ...overrides,
  });
}

test("an interrupted run past the grace window resolves to failed/interrupted", () => {
  const actions = base();
  const resolve = actions.find((action) => action.kind === "resolve-interrupted");
  assert.ok(resolve !== undefined);
  assert.equal(resolve.reason, "interrupted");
  assert.equal(resolve.targetState, "failed");
  assert.deepEqual(resolve.labelsToAdd, [labels.failed]);
  assert.deepEqual(resolve.labelsToRemove, [labels.working]);
});

test("a run inside the grace window is left alone", () => {
  const actions = base({ workingSince: "2026-10-26T11:45:00.000Z" });
  assert.deepEqual(actions.map((action) => action.kind), ["none"]);
});

test("a half-applied state-label change is repaired to the log's state", () => {
  const actions = base({
    presentLabels: [labels.request, labels.working, labels.waiting],
    logState: "waiting",
    workingSince: null,
  });
  const repair = actions.find((action) => action.kind === "repair-labels");
  assert.ok(repair !== undefined);
  assert.equal(repair.reason, "half-applied-labels");
  assert.equal(repair.targetState, "waiting");
  assert.deepEqual(repair.labelsToRemove, [labels.working]);
  assert.deepEqual(repair.labelsToAdd, [labels.waiting]);
});

test("an active job is never touched", () => {
  const actions = base({ activeJob: true });
  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.kind, "none");
  assert.match(actions[0]?.note ?? "", /active job/);
});

test("a timestamp that cannot be parsed is treated as stuck", () => {
  const actions = base({ workingSince: "not-a-date" });
  assert.ok(actions.some((action) => action.kind === "resolve-interrupted"));
});

test("the summary is a single English line", () => {
  assert.match(summarizeActions(base()), /^Reconciliation complete: #7 resolve-interrupted \(interrupted\)\.$/);
  assert.equal(summarizeActions(base({ activeJob: true })), "Reconciliation complete: nothing to repair.");
});
