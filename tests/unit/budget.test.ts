import assert from "node:assert/strict";
import test from "node:test";

import { Budget } from "../../src/agent/budget.js";
import type { LimitConfig } from "../../src/agent/config.js";

const limits: LimitConfig = {
  maxCostUsd: 5,
  warnAtRatio: 0.8,
  continueIncrementUsd: 2,
  maxTurns: 10,
  maxWallClockMinutes: 30,
  startDeadlineSeconds: 180,
};

test("a run below the warning ratio is ok", () => {
  let now = 0;
  const budget = new Budget({ limits, priorConsumedUsd: 0, startedAtMs: 0, now: () => now });
  assert.deepEqual(budget.check({ sessionCostUsd: 1, turns: 1 }), { status: "ok" });
});

test("the soft warning fires once at the configured ratio", () => {
  const budget = new Budget({ limits, priorConsumedUsd: 0, startedAtMs: 0, now: () => 0 });
  const first = budget.check({ sessionCostUsd: 4.1, turns: 1 });
  assert.equal(first.status, "warn");
  assert.equal(budget.hasWarned, true);
  assert.deepEqual(budget.check({ sessionCostUsd: 4.2, turns: 2 }), { status: "ok" });
});

test("the hard stop is evaluated against the sum of documented sessions", () => {
  const budget = new Budget({ limits, priorConsumedUsd: 4.5, startedAtMs: 0, now: () => 0 });
  const verdict = budget.check({ sessionCostUsd: 0.6, turns: 1 });
  assert.equal(verdict.status, "stop");
  assert.equal(verdict.status === "stop" ? verdict.cause : null, "cost");
  assert.equal(verdict.status === "stop" ? verdict.capUsd : 0, 5);
});

test("a lost cache cannot reset the limit", () => {
  const budget = new Budget({ limits, priorConsumedUsd: 4.9, startedAtMs: 0, now: () => 0 });
  assert.equal(budget.check({ sessionCostUsd: 0.2, turns: 1 }).status, "stop");
});

test("maxTurns stops the run regardless of cost", () => {
  const budget = new Budget({ limits, priorConsumedUsd: 0, startedAtMs: 0, now: () => 0 });
  const verdict = budget.check({ sessionCostUsd: 0.1, turns: 10 });
  assert.equal(verdict.status === "stop" ? verdict.cause : null, "turns");
});

test("maxWallClockMinutes stops the run regardless of cost", () => {
  let now = 0;
  const budget = new Budget({ limits, priorConsumedUsd: 0, startedAtMs: 0, now: () => now });
  now = 30 * 60_000;
  const verdict = budget.check({ sessionCostUsd: 0.1, turns: 1 });
  assert.equal(verdict.status === "stop" ? verdict.cause : null, "wall-clock");
});

test("a recorded continue raises the allowance by exactly one increment", () => {
  const budget = new Budget({ limits, priorConsumedUsd: 4.5, startedAtMs: 0, now: () => 0 });
  assert.equal(budget.capUsd, 5);
  assert.equal(budget.check({ sessionCostUsd: 0.6, turns: 1 }).status, "stop");
  budget.registerContinue();
  assert.equal(budget.capUsd, 7);
  assert.equal(budget.allowanceRaisedUsd, 2);
  const verdict = budget.check({ sessionCostUsd: 0.6, turns: 1 });
  assert.equal(verdict.status, "ok");
});

test("the warning window reopens after a continue", () => {
  const budget = new Budget({ limits, priorConsumedUsd: 0, startedAtMs: 0, now: () => 0 });
  assert.equal(budget.check({ sessionCostUsd: 4.1, turns: 1 }).status, "warn");
  budget.registerContinue();
  assert.equal(budget.hasWarned, false);
});
