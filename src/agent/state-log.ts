/**
 * Append-only state log inside the single `agent:status` comment
 * (contracts/thread-messages.md §2, FR-016, SC-005).
 *
 * Rows are appended and never rewritten, so the comment body itself is the state
 * timeline and no comment edit history is required. The newest row is
 * authoritative: if the label disagrees with it, the label is corrected
 * (invariant I2, direction log → label).
 */

import { STATE_NAMES, type StateName } from "./labels.js";
import type { StatusRowView } from "./messages.js";

export interface StateRow {
  at: string;
  state: StateName;
  runId: string;
  /** Display value such as `$0.00`; `unknown` when nothing was observed. */
  consumed: string;
  nextAct: string;
}

export class StateLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateLogError";
  }
}

export function isStateName(value: string): value is StateName {
  return (STATE_NAMES as readonly string[]).includes(value);
}

export class StateLog {
  private readonly rowList: StateRow[] = [];
  private readonly noteList: string[] = [];

  constructor(rows: readonly StateRow[] = [], notes: readonly string[] = []) {
    for (const row of rows) this.rowList.push({ ...row });
    for (const note of notes) this.noteList.push(note);
  }

  get rows(): readonly StateRow[] {
    return this.rowList;
  }

  get notes(): readonly string[] {
    return this.noteList;
  }

  get length(): number {
    return this.rowList.length;
  }

  newest(): StateRow | undefined {
    return this.rowList.length === 0 ? undefined : this.rowList[this.rowList.length - 1];
  }

  /**
   * Append a row. Rows must move forward in time and states must be known; a bad
   * row is a defect, not something to quietly fix.
   */
  append(row: StateRow): StateRow {
    if (!isStateName(row.state)) throw new StateLogError(`unknown state: ${row.state}`);
    if (row.runId.trim().length === 0) throw new StateLogError("a state row requires a run id");
    if (row.at.trim().length === 0) throw new StateLogError("a state row requires a timestamp");
    const previous = this.newest();
    if (previous !== undefined && row.at < previous.at) {
      throw new StateLogError(`state rows must be chronological: ${row.at} < ${previous.at}`);
    }
    const stored: StateRow = { ...row };
    this.rowList.push(stored);
    return stored;
  }

  /**
   * Append only when the visible facts changed, so a duplicate event (re-delivery,
   * duplicate label event) produces no second row.
   */
  appendIfChanged(row: StateRow): StateRow | null {
    const previous = this.newest();
    if (
      previous !== undefined &&
      previous.state === row.state &&
      previous.runId === row.runId &&
      previous.consumed === row.consumed &&
      previous.nextAct === row.nextAct
    ) {
      return null;
    }
    return this.append(row);
  }

  appendNote(note: string): void {
    const trimmed = note.trim();
    if (trimmed.length === 0) return;
    this.noteList.push(trimmed);
  }

  /** The newest row must agree with what the caller is about to publish. */
  assertNewestIs(state: StateName): void {
    const newest = this.newest();
    if (newest === undefined) throw new StateLogError("state log is empty");
    if (newest.state !== state) {
      throw new StateLogError(`newest state row is ${newest.state}, but ${state} was published`);
    }
  }

  /**
   * Reconcile an observed state label against the log. The log wins; the caller
   * applies `authoritative` when `repaired` is true.
   */
  reconcileLabel(observed: StateName | null): { authoritative: StateName; repaired: boolean } {
    const newest = this.newest();
    if (newest === undefined) {
      if (observed === null) throw new StateLogError("no state row and no state label");
      return { authoritative: observed, repaired: false };
    }
    return { authoritative: newest.state, repaired: observed !== newest.state };
  }

  toStatusRows(): StatusRowView[] {
    return this.rowList.map((row) => ({
      at: row.at,
      state: row.state,
      runId: row.runId,
      consumed: row.consumed,
      nextAct: row.nextAct,
    }));
  }

  toJSON(): { rows: StateRow[]; notes: string[] } {
    return { rows: this.rowList.map((row) => ({ ...row })), notes: [...this.noteList] };
  }

  static fromJSON(value: { rows?: StateRow[]; notes?: string[] }): StateLog {
    return new StateLog(value.rows ?? [], value.notes ?? []);
  }
}

const ROW_PATTERN = /^\|\s*([^|]+?)\s*\|\s*`?([a-z-]+)`?\s*\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/;

/**
 * Parse the state-log table out of an existing status comment, so a later run can
 * continue the same append-only body instead of starting a second one.
 */
export function parseStateRows(statusBody: string): StateRow[] {
  const rows: StateRow[] = [];
  for (const line of statusBody.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    const match = ROW_PATTERN.exec(line.trim());
    if (!match) continue;
    const [, at, state, runId, consumed, nextAct] = match;
    if (at === undefined || state === undefined || runId === undefined) continue;
    if (!isStateName(state)) continue;
    if (at.toLowerCase() === "at") continue;
    rows.push({
      at: at.trim(),
      state,
      runId: runId.trim(),
      consumed: (consumed ?? "unknown").trim(),
      nextAct: (nextAct ?? "none").trim(),
    });
  }
  return rows;
}

/** Parse the `**Notes**` block that follows the state table. */
export function parseStateNotes(statusBody: string): string[] {
  const notes: string[] = [];
  const index = statusBody.indexOf("**Notes**");
  if (index < 0) return notes;
  for (const line of statusBody.slice(index).split("\n")) {
    if (line.startsWith("- ")) notes.push(line.slice(2).trim());
  }
  return notes;
}

export function parseStatusComment(statusBody: string): StateLog {
  return new StateLog(parseStateRows(statusBody), parseStateNotes(statusBody));
}
