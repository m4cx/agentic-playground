/**
 * Consumption budget (FR-017, contracts/config.md).
 *
 * The cap applies to the per-issue total — the sum of documented sessions plus the
 * running session — so a lost cache cannot reset it. A soft warning is posted once
 * per run; a hard stop posts `agent:limit` and requires an explicit
 * `/agent continue`, which raises the allowance by the configured increment.
 */

import type { LimitConfig } from "./config.js";

export type StopCause = "cost" | "turns" | "wall-clock";

export type BudgetVerdict =
  | { status: "ok" }
  | { status: "warn"; consumedUsd: number; capUsd: number }
  | { status: "stop"; cause: StopCause; consumedUsd: number; capUsd: number; turns: number };

export interface BudgetOptions {
  limits: LimitConfig;
  /** Documented consumption of earlier sessions for this issue. */
  priorConsumedUsd: number;
  /** Allowance already granted by earlier `continue` decisions. */
  priorAllowanceUsd?: number;
  startedAtMs: number;
  now?: () => number;
}

export class Budget {
  private readonly limits: LimitConfig;
  private readonly priorConsumedUsd: number;
  private readonly startedAtMs: number;
  private readonly now: () => number;
  private allowanceUsd: number;
  private warningPosted = false;
  private stopped: StopCause | null = null;

  constructor(options: BudgetOptions) {
    this.limits = options.limits;
    this.priorConsumedUsd = options.priorConsumedUsd;
    this.allowanceUsd = options.priorAllowanceUsd ?? 0;
    this.startedAtMs = options.startedAtMs;
    this.now = options.now ?? (() => Date.now());
  }

  /** Total allowance for the issue: base cap plus recorded increments. */
  get capUsd(): number {
    return this.limits.maxCostUsd + this.allowanceUsd;
  }

  get hasWarned(): boolean {
    return this.warningPosted;
  }

  get stopCause(): StopCause | null {
    return this.stopped;
  }

  /**
   * Check the budget at an action boundary.
   *
   * `sessionCostUsd` is what the running session has consumed so far; the sum of
   * documented sessions (`priorConsumedUsd`) is added to it.
   */
  check(input: { sessionCostUsd: number; turns: number; sessionTurns?: number }): BudgetVerdict {
    const consumedUsd = this.priorConsumedUsd + input.sessionCostUsd;
    const turns = input.turns;
    const elapsedMinutes = (this.now() - this.startedAtMs) / 60_000;

    if (consumedUsd >= this.capUsd) {
      this.stopped = "cost";
      return { status: "stop", cause: "cost", consumedUsd, capUsd: this.capUsd, turns };
    }
    if (turns >= this.limits.maxTurns) {
      this.stopped = "turns";
      return { status: "stop", cause: "turns", consumedUsd, capUsd: this.capUsd, turns };
    }
    if (elapsedMinutes >= this.limits.maxWallClockMinutes) {
      this.stopped = "wall-clock";
      return { status: "stop", cause: "wall-clock", consumedUsd, capUsd: this.capUsd, turns };
    }
    if (!this.warningPosted && consumedUsd >= this.capUsd * this.limits.warnAtRatio) {
      this.warningPosted = true;
      return { status: "warn", consumedUsd, capUsd: this.capUsd };
    }
    return { status: "ok" };
  }

  /**
   * Apply a recorded `continue` decision. Called once per decision by the caller;
   * a decision that was not recorded must not reach this method.
   */
  registerContinue(): number {
    this.allowanceUsd += this.limits.continueIncrementUsd;
    // A new allowance gives the run another warning window.
    this.warningPosted = false;
    this.stopped = null;
    return this.allowanceUsd;
  }

  get allowanceRaisedUsd(): number {
    return this.allowanceUsd;
  }
}
