import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../../src/agent/config.js";
import {
  isTerminal,
  LabelManager,
  nextState,
  presentStates,
  repairPreference,
  stateFromLabel,
  stateMeaning,
  type StateName,
} from "../../src/agent/labels.js";

const labels = loadConfig(process.cwd()).config.labels;

class RecordingWriter {
  readonly added: string[] = [];
  readonly removed: string[] = [];

  async addLabels(_issueNumber: number, names: string[]): Promise<unknown> {
    this.added.push(...names);
    return names;
  }

  async removeLabel(_issueNumber: number, label: string): Promise<void> {
    this.removed.push(label);
  }
}

test("the state label mapping round-trips", () => {
  for (const state of ["queued", "working", "waiting", "halted", "finished", "failed", "rejected"] as const) {
    assert.equal(stateFromLabel(labels, labels[state]), state);
    assert.ok(stateMeaning(state).length > 5);
  }
  assert.equal(stateFromLabel(labels, labels.request), null);
});

test("the request label is not a state", () => {
  assert.deepEqual(presentStates(labels, [labels.request]), []);
  assert.deepEqual(presentStates(labels, [labels.request, labels.working]), ["working"]);
});

test("terminal states are sticky and only an explicit retry may leave them", () => {
  for (const state of ["finished", "failed", "rejected"] as const) {
    assert.equal(isTerminal(state), true);
    assert.equal(nextState(state, "job-start"), null);
    assert.equal(nextState(state, "boundary-halt"), null);
  }
  // The transition table permits a retry from failed, halted, and rejected; finished
  // is only left by a new request label, which is a separate start, not a transition.
  for (const state of ["failed", "halted", "rejected"] as const) {
    assert.equal(nextState(state, "retry-command"), "working");
  }
});

test("non-terminal states follow the transition table", () => {
  assert.equal(nextState(null, "request-added"), "queued");
  assert.equal(nextState("queued", "job-start"), "working");
  assert.equal(nextState("queued", "halt-command"), "halted");
  assert.equal(nextState("working", "boundary-halt"), "halted");
  assert.equal(nextState("working", "limit-reached"), "waiting");
  assert.equal(nextState("working", "ambiguity"), "waiting");
  assert.equal(nextState("working", "proposal-created"), "waiting");
  assert.equal(nextState("working", "no-changes"), "finished");
  assert.equal(nextState("working", "job-died"), "failed");
  assert.equal(nextState("working", "retry-signal"), "failed");
  assert.equal(nextState("waiting", "continue-command"), "working");
  assert.equal(nextState("waiting", "proposal-merged"), "finished");
  assert.equal(nextState("waiting", "proposal-closed"), "rejected");
  assert.equal(nextState("halted", "retry-command"), "working");
});

test("an impossible transition is refused, not silently mapped", () => {
  assert.equal(nextState("finished", "continue-command"), null);
  assert.equal(nextState("queued", "proposal-merged"), null);
  assert.equal(nextState("waiting", "job-start"), null);
});

test("I1: applying a state removes every other state label", async () => {
  const writer = new RecordingWriter();
  const manager = new LabelManager(writer, labels, 7);
  await manager.applyState([labels.request, labels.working], "waiting");
  assert.deepEqual(writer.removed, [labels.working]);
  assert.deepEqual(writer.added, [labels.waiting]);
});

test("applying the state that is already present writes nothing", async () => {
  const writer = new RecordingWriter();
  const manager = new LabelManager(writer, labels, 7);
  await manager.applyState([labels.request, labels.waiting], "waiting");
  assert.deepEqual(writer.removed, []);
  assert.deepEqual(writer.added, []);
});

test("a duplicate trigger while non-terminal is collapsed", () => {
  const manager = new LabelManager(new RecordingWriter(), labels, 7);
  assert.equal(manager.isDuplicateRequest([labels.request, labels.working]), true);
  assert.equal(manager.isDuplicateRequest([labels.request]), false);
  assert.equal(manager.isDuplicateRequest([labels.request, labels.finished]), false);
});

test("the request label is re-applied with remove-then-add", async () => {
  const writer = new RecordingWriter();
  const manager = new LabelManager(writer, labels, 7);
  await manager.retriggerRequestLabel();
  assert.deepEqual(writer.removed, [labels.request]);
  assert.deepEqual(writer.added, [labels.request]);
});

test("repair preference picks a deterministic state when several are present", () => {
  const states: StateName[] = ["working", "waiting"];
  assert.equal(repairPreference(states), "working");
  assert.equal(repairPreference([]), null);
});

test("a missing label removal is tolerated", async () => {
  const writer = {
    async addLabels() {
      return [];
    },
    async removeLabel() {
      throw Object.assign(new Error("not found"), { status: 404 });
    },
  };
  const manager = new LabelManager(writer, labels, 7);
  await manager.applyState([labels.working], "waiting");
});
