/**
 * Reconciliation of interrupted runs and half-applied label changes
 * (invariant I5, contracts/config.md §"Sweep window", FR-011).
 *
 * A run that dies while holding `agent:working` is indistinguishable from a live
 * one until the grace window passes. After that it resolves to `failed` with reason
 * `interrupted`. A job that is demonstrably active is never touched.
 */

import type { LabelConfig } from "./config.js";
import { STATE_NAMES, type StateName } from "./labels.js";

export interface ReconcileInput {
  issueNumber: number;
  presentLabels: readonly string[];
  /** Newest state row of the status log, if the thread has one. */
  logState: StateName | null;
  /** Timestamp of the `working` state row, if any. */
  workingSince: string | null;
  /** True when a job currently owns the issue (queued run, active run). */
  activeJob: boolean;
  nowMs: number;
  graceMinutes: number;
  labels: LabelConfig;
}

export type ReconcileActionKind = "resolve-interrupted" | "repair-labels" | "none";

export interface ReconcileAction {
  issueNumber: number;
  kind: ReconcileActionKind;
  reason: "interrupted" | "half-applied-labels" | null;
  targetState: StateName | null;
  labelsToRemove: string[];
  labelsToAdd: string[];
  note: string;
}

function statesPresent(labels: LabelConfig, present: readonly string[]): StateName[] {
  return STATE_NAMES.filter((state) => present.includes(labels[state]));
}

export function planReconciliation(input: ReconcileInput): ReconcileAction[] {
  const actions: ReconcileAction[] = [];
  const states = statesPresent(input.labels, input.presentLabels);

  if (input.activeJob) {
    // A queued or running job owns the issue; the sweeper must not interfere.
    return [{ ...noAction(input), note: "an active job owns this issue" }];
  }

  if (states.length > 1) {
    const authoritative = input.logState ?? states[0] ?? null;
    actions.push({
      issueNumber: input.issueNumber,
      kind: "repair-labels",
      reason: "half-applied-labels",
      targetState: authoritative,
      labelsToRemove: states.filter((state) => state !== authoritative).map((state) => input.labels[state]),
      labelsToAdd: authoritative === null ? [] : [input.labels[authoritative]],
      note:
        authoritative === null
          ? "removed conflicting state labels"
          : `kept the state label of the newest log row (${authoritative})`,
    });
  }

  const effectiveState = input.logState ?? states[0] ?? null;
  if (effectiveState === "working" && input.workingSince !== null) {
    const workingSinceMs = Date.parse(input.workingSince);
    const ageMinutes = Number.isFinite(workingSinceMs) ? (input.nowMs - workingSinceMs) / 60_000 : Number.POSITIVE_INFINITY;
    if (ageMinutes >= input.graceMinutes) {
      actions.push({
        issueNumber: input.issueNumber,
        kind: "resolve-interrupted",
        reason: "interrupted",
        targetState: "failed",
        labelsToRemove: states
          .filter((state) => state !== "failed")
          .map((state) => input.labels[state]),
        labelsToAdd: [input.labels.failed],
        note: `no activity for ${Math.floor(ageMinutes)} minutes; resolved as failed/interrupted`,
      });
    }
  }

  if (actions.length === 0) return [noAction(input)];
  return actions;
}

function noAction(input: ReconcileInput): ReconcileAction {
  return {
    issueNumber: input.issueNumber,
    kind: "none",
    reason: null,
    targetState: null,
    labelsToRemove: [],
    labelsToAdd: [],
    note: "nothing to repair",
  };
}

/** A one-line English summary of what a sweep repaired. */
export function summarizeActions(actions: readonly ReconcileAction[]): string {
  const repaired = actions.filter((action) => action.kind !== "none");
  if (repaired.length === 0) return "Reconciliation complete: nothing to repair.";
  const parts = repaired.map(
    (action) => `#${action.issueNumber} ${action.kind}${action.reason === null ? "" : ` (${action.reason})`}`,
  );
  return `Reconciliation complete: ${parts.join(", ")}.`;
}
