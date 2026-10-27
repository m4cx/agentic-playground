/**
 * Label state machine (contracts/labels.md).
 *
 * Labels mirror state for visibility; the append-only state log is authoritative.
 * Invariants enforced here:
 *   I1 one state label at a time (applyState removes every other state label)
 *   I3 terminal labels are sticky (only an explicit retry command leaves them)
 */

import type { LabelConfig } from "./config.js";

export const STATE_NAMES = ["queued", "working", "waiting", "halted", "finished", "failed", "rejected"] as const;
export type StateName = (typeof STATE_NAMES)[number];

export const TERMINAL_STATES: ReadonlySet<StateName> = new Set<StateName>(["finished", "failed", "rejected"]);

export type LabelEvent =
  | "request-added"
  | "job-start"
  | "halt-command"
  | "global-halt"
  | "boundary-halt"
  | "limit-reached"
  | "ambiguity"
  | "proposal-created"
  | "no-changes"
  | "job-died"
  | "retry-signal"
  | "continue-command"
  | "approve-command"
  | "reject-command"
  | "proposal-merged"
  | "proposal-closed"
  | "retry-command";

interface Transition {
  from: StateName | null;
  event: LabelEvent;
  to: StateName;
}

/**
 * Authoritative transition table. There is deliberately no transition out of a
 * terminal state except an explicit retry command.
 */
const TRANSITIONS: readonly Transition[] = [
  { from: null, event: "request-added", to: "queued" },
  { from: "queued", event: "job-start", to: "working" },
  { from: "queued", event: "halt-command", to: "halted" },
  { from: "queued", event: "global-halt", to: "halted" },
  { from: "working", event: "boundary-halt", to: "halted" },
  { from: "working", event: "global-halt", to: "halted" },
  { from: "working", event: "limit-reached", to: "waiting" },
  { from: "working", event: "ambiguity", to: "waiting" },
  { from: "working", event: "proposal-created", to: "waiting" },
  { from: "working", event: "no-changes", to: "finished" },
  { from: "working", event: "job-died", to: "failed" },
  { from: "working", event: "retry-signal", to: "failed" },
  { from: "waiting", event: "continue-command", to: "working" },
  { from: "waiting", event: "approve-command", to: "waiting" },
  { from: "waiting", event: "reject-command", to: "rejected" },
  { from: "waiting", event: "proposal-merged", to: "finished" },
  { from: "waiting", event: "proposal-closed", to: "rejected" },
  { from: "halted", event: "retry-command", to: "working" },
  { from: "halted", event: "continue-command", to: "working" },
  { from: "failed", event: "retry-command", to: "working" },
  { from: "rejected", event: "retry-command", to: "working" },
];

/**
 * Resolve the next state, or null when the event is not permitted from the current
 * state. Null is a refusal, never a fallback: the caller records nothing.
 */
export function nextState(current: StateName | null, event: LabelEvent): StateName | null {
  const transition = TRANSITIONS.find((entry) => entry.from === current && entry.event === event);
  return transition?.to ?? null;
}

export function isTerminal(state: StateName): boolean {
  return TERMINAL_STATES.has(state);
}

/** Event that a transition requires, or null when no transition matches. */
export function findTransition(
  current: StateName | null,
  to: StateName,
): { event: LabelEvent; to: StateName } | null {
  const transition = TRANSITIONS.find((entry) => entry.from === current && entry.to === to);
  if (transition === undefined) return null;
  return { event: transition.event, to: transition.to };
}

export function stateLabel(labels: LabelConfig, state: StateName): string {
  return labels[state];
}

export function stateFromLabel(labels: LabelConfig, label: string): StateName | null {
  for (const state of STATE_NAMES) {
    if (labels[state] === label) return state;
  }
  return null;
}

/** All state labels currently present. More than one is an I1 violation to repair. */
export function presentStates(labels: LabelConfig, present: readonly string[]): StateName[] {
  const states: StateName[] = [];
  for (const state of STATE_NAMES) {
    if (present.includes(labels[state])) states.push(state);
  }
  return states;
}

/**
 * When more than one state label is present (a process died mid-change), the log
 * decides — the caller passes the authoritative state and this returns the labels
 * that must be removed. Preference order is only a tie-break for the sweep.
 */
export function repairPreference(states: readonly StateName[]): StateName | null {
  for (const state of STATE_NAMES) {
    if (states.includes(state)) return state;
  }
  return null;
}

export function stateMeaning(state: StateName): string {
  const meanings: Record<StateName, string> = {
    queued: "the request was accepted and the job has not started yet.",
    working: "a run is active.",
    waiting: "a person must decide or answer before work continues.",
    halted: "work was stopped and can be resumed with a command.",
    finished: "the run ended successfully.",
    failed: "the run ended with a failure reason recorded above.",
    rejected: "the proposal was not accepted; no automatic retry follows.",
  };
  return meanings[state];
}

export function nextActFor(state: StateName, proposalOpen: boolean): string {
  switch (state) {
    case "waiting":
      return proposalOpen ? "review the proposal" : "post `/agent continue`";
    case "halted":
      return "post `/agent retry`";
    case "failed":
      return "read the failure reason";
    case "finished":
    case "rejected":
      return "none";
    case "queued":
    case "working":
      return "none";
  }
}

export interface LabelWriter {
  addLabels(issueNumber: number, labels: string[]): Promise<unknown>;
  removeLabel(issueNumber: number, label: string): Promise<void>;
}

/**
 * Applies state changes so that the one-state invariant holds after every call.
 * A missing label removal (for example a label that is not applied) is tolerated;
 * any other failure propagates, because a half-applied change must be repaired by
 * the reconciler rather than hidden.
 */
export class LabelManager {
  private readonly writer: LabelWriter;
  private readonly labels: LabelConfig;
  private readonly issueNumber: number;

  constructor(writer: LabelWriter, labels: LabelConfig, issueNumber: number) {
    this.writer = writer;
    this.labels = labels;
    this.issueNumber = issueNumber;
  }

  /** Remove every state label except the target, then add the target. */
  async applyState(present: readonly string[], target: StateName): Promise<void> {
    const current = presentStates(this.labels, present);
    for (const state of current) {
      if (state === target) continue;
      await this.removeIfPresent(this.labels[state]);
    }
    if (!present.includes(this.labels[target])) {
      await this.writer.addLabels(this.issueNumber, [this.labels[target]]);
    }
  }

  /** The request label stays applied across runs; re-triggering is remove-then-add. */
  async retriggerRequestLabel(): Promise<void> {
    await this.removeIfPresent(this.labels.request, true);
    await this.writer.addLabels(this.issueNumber, [this.labels.request]);
  }

  async addProposalLabel(): Promise<void> {
    await this.writer.addLabels(this.issueNumber, [this.labels.proposal]);
  }

  /**
   * A `labeled` event for the request label while the issue is in a non-terminal
   * state is a duplicate delivery, not a second run.
   */
  isDuplicateRequest(present: readonly string[]): boolean {
    if (!present.includes(this.labels.request)) return false;
    const states = presentStates(this.labels, present);
    return states.some((state) => !isTerminal(state));
  }

  private async removeIfPresent(label: string, ignoreMissing = false): Promise<void> {
    try {
      await this.writer.removeLabel(this.issueNumber, label);
    } catch (error) {
      if (ignoreMissing) return;
      const status = (error as { status?: number }).status;
      if (status === 404) return;
      throw error;
    }
  }
}
