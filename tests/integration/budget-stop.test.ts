import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseIssueTrigger } from "../../src/agent/events.js";
import { fakeWorkspaceState, makeHarness, stubLogPath } from "../fake-github.js";

function triggerFor(harness: ReturnType<typeof makeHarness>, issueNumber: number) {
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

test("a limit stops the run at a boundary, posts the notice, and waits", async () => {
  const harness = makeHarness({
    limits: { maxCostUsd: 0.3, warnAtRatio: 0.5, continueIncrementUsd: 2 },
    stubEnv: { STUB_PI_TURNS: "5", STUB_PI_COST_PER_TURN: "0.25", STUB_PI_TURN_DELAY_MS: "5" },
    workspace: fakeWorkspaceState([]),
  });
  harness.github.addIssue({ number: 31, title: "Expensive task", body: "Work hard.", labels: ["agent:run"] });

  const result = await harness.orchestrator.run(triggerFor(harness, 31));
  assert.equal(result.status, "waiting");

  const warnings = harness.github.markerComments(31, "limit");
  assert.ok(warnings.length >= 1);
  const bodies = warnings.map((comment) => comment.body ?? "");
  assert.ok(bodies.some((body) => /Consumption warning/.test(body)), "a soft warning was posted");
  const limit = bodies.find((body) => /Consumption limit reached/.test(body));
  assert.ok(limit !== undefined, "the hard stop was posted");
  assert.match(limit, /\/agent continue/);
  assert.match(limit, /raises this issue's allowance/);

  assert.deepEqual(harness.github.labelsOf(31).sort(), ["agent:run", "agent:waiting"]);
  assert.equal(harness.github.markerComments(31, "result").length, 0);

  // The run stopped at a boundary and consumed only the turns it was allowed.
  const log = readFileSync(stubLogPath(harness), "utf8");
  const turnEnds = log.split("\n").filter((line) => line.includes('"event":"turn_end"'));
  assert.equal(turnEnds.length, 2);
  assert.ok(log.includes('"type":"abort"'));
});

test("a continue decision raises the allowance once and resumes", async () => {
  const harness = makeHarness({
    limits: { maxCostUsd: 0.3, warnAtRatio: 0.5, continueIncrementUsd: 2 },
    stubEnv: { STUB_PI_TURNS: "1", STUB_PI_COST_PER_TURN: "0.25" },
    workspace: fakeWorkspaceState([]),
  });
  harness.github.addIssue({ number: 32, title: "Retry after limit", body: "Work.", labels: ["agent:run", "agent:waiting"] });
  harness.github.addComment(32, {
    login: "agent",
    body: [
      "<!-- agent:status issue=32 -->",
      "**State:** `waiting` — a person must decide.",
      "",
      "| At | State | Run | Consumed | Next act |",
      "|----|-------|-----|----------|----------|",
      "| 2026-10-26T09:50:00.000Z | `working` | `run-earlier` | $0.00 | none |",
      "| 2026-10-26T09:55:00.000Z | `waiting` | `run-earlier` | $0.30 | post `/agent continue` |",
    ].join("\n"),
  });
  harness.github.addComment(32, {
    login: "agent",
    body: [
      "<!-- agent:session issue=32 run=run-earlier-agent-issue-32-x -->",
      "Session ended.",
      "",
      "- Session: `agent-issue-32-old` (fingerprint `abcdef123456`)",
      "- Runs: `run-earlier`",
      "- Consumed: `$0.30` (`1000` tokens, `2` turns, `2` tool calls)",
      "- Ended because: run failed",
      "- Issue total: `$0.30` of `$0.30`",
    ].join("\n"),
  });

  const result = await harness.orchestrator.handleCommand({
    issue: harness.github.issues.get(32),
    comment: {
      id: 6001,
      body: "/agent continue",
      user: { login: "maintainer" },
      created_at: new Date().toISOString(),
    },
  });
  assert.equal(result.status, "finished");

  const decisions = harness.github.markerComments(32, "decision").map((comment) => comment.body ?? "");
  assert.ok(decisions.some((body) => /Decision recorded: `continue`/.test(body)));

  const acks = harness.github.markerComments(32, "ack").map((comment) => comment.body ?? "");
  assert.equal(acks.length, 1);
  assert.match(acks[0] ?? "", /cap `\$2\.30`/, "the allowance was raised by exactly one increment");
  assert.match(acks[0] ?? "", /Continues run: `run-earlier`/);
});
