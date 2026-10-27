import assert from "node:assert/strict";
import test from "node:test";

import {
  parseStateRows,
  parseStatusComment,
  StateLog,
  StateLogError,
  type StateRow,
} from "../../src/agent/state-log.js";
import { renderStatus } from "../../src/agent/messages.js";

function row(state: StateRow["state"], at: string, consumed = "$0.00", runId = "run-1"): StateRow {
  return { at, state, runId, consumed, nextAct: "none" };
}

test("rows are appended and never rewritten", () => {
  const log = new StateLog();
  log.append(row("queued", "2026-10-26T10:00:00.000Z"));
  log.append(row("working", "2026-10-26T10:00:01.000Z"));
  log.append(row("waiting", "2026-10-26T10:05:00.000Z", "$0.50"));
  assert.equal(log.rows.length, 3);
  assert.deepEqual(
    log.rows.map((entry) => entry.state),
    ["queued", "working", "waiting"],
  );
  assert.equal(log.newest()?.state, "waiting");
});

test("appending an identical event produces no second row", () => {
  const log = new StateLog();
  log.append(row("working", "2026-10-26T10:00:00.000Z"));
  assert.equal(log.appendIfChanged(row("working", "2026-10-26T10:00:00.000Z")), null);
  assert.equal(log.rows.length, 1);
  assert.notEqual(log.appendIfChanged(row("working", "2026-10-26T10:00:00.000Z", "$0.25")), null);
  assert.equal(log.rows.length, 2);
});

test("rows must be chronological", () => {
  const log = new StateLog([row("working", "2026-10-26T10:00:02.000Z")]);
  assert.throws(() => log.append(row("waiting", "2026-10-26T10:00:01.000Z")), StateLogError);
});

test("unknown states and empty run ids are rejected", () => {
  const log = new StateLog();
  assert.throws(() => log.append({ ...row("working", "2026-10-26T10:00:00.000Z"), state: "napping" as never }), StateLogError);
  assert.throws(() => log.append(row("working", "2026-10-26T10:00:00.000Z", "$0.00", "")), StateLogError);
});

test("the newest row must match the published state", () => {
  const log = new StateLog([row("working", "2026-10-26T10:00:00.000Z")]);
  log.assertNewestIs("working");
  assert.throws(() => log.assertNewestIs("waiting"), StateLogError);
});

test("the log wins when the label disagrees", () => {
  const log = new StateLog([
    row("working", "2026-10-26T10:00:00.000Z"),
    row("waiting", "2026-10-26T10:05:00.000Z"),
  ]);
  assert.deepEqual(log.reconcileLabel("working"), { authoritative: "waiting", repaired: true });
  assert.deepEqual(log.reconcileLabel("waiting"), { authoritative: "waiting", repaired: false });
});

test("re-rendering is idempotent", () => {
  const log = new StateLog([
    row("queued", "2026-10-26T10:00:00.000Z"),
    row("working", "2026-10-26T10:00:01.000Z", "$0.10"),
  ]);
  const input = {
    issueNumber: 7,
    runId: "run-1",
    state: "working" as const,
    stateMeaning: "a run is active.",
    startedAt: "2026-10-26T10:00:00.000Z",
    consumedUsd: 0.1,
    capUsd: 5,
    turns: 1,
    proposalUrl: null,
    nextAct: "none",
    notes: [],
  };
  const first = renderStatus({ ...input, rows: log.toStatusRows() });
  const second = renderStatus({ ...input, rows: log.toStatusRows() });
  assert.equal(first, second);
});

test("a rendered status comment parses back into the same rows", () => {
  const log = new StateLog([
    row("queued", "2026-10-26T10:00:00.000Z"),
    row("working", "2026-10-26T10:00:01.000Z", "$0.25"),
    row("waiting", "2026-10-26T10:05:00.000Z", "$0.50"),
  ]);
  log.appendNote("A note about a missing report.");
  const body = renderStatus({
    issueNumber: 7,
    runId: "run-1",
    state: "waiting",
    stateMeaning: "a person must decide.",
    startedAt: "2026-10-26T10:00:00.000Z",
    consumedUsd: 0.5,
    capUsd: 5,
    turns: 3,
    proposalUrl: null,
    nextAct: "post `/agent continue`",
    rows: log.toStatusRows(),
    notes: log.notes,
  });
  const parsed = parseStatusComment(body);
  assert.deepEqual(parsed.rows.map((entry) => entry.state), ["queued", "working", "waiting"]);
  assert.equal(parsed.rows[2]?.consumed, "$0.50");
  assert.deepEqual(parsed.notes, ["A note about a missing report."]);
  assert.deepEqual(parseStateRows("| no | table | here |"), []);
});

test("round-trips through JSON for cache-free continuity", () => {
  const log = new StateLog([row("working", "2026-10-26T10:00:00.000Z")]);
  log.appendNote("note");
  const restored = StateLog.fromJSON(log.toJSON());
  assert.deepEqual(restored.rows, log.rows);
  assert.deepEqual(restored.notes, log.notes);
});
