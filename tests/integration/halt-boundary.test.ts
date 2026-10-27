import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseIssueTrigger } from "../../src/agent/events.js";
import { fakeWorkspaceState, makeHarness, stubLogPath } from "../fake-github.js";

test("a halt is applied only after turn_end, preceded by feedback, with no queued steering", async () => {
  const harness = makeHarness({
    stubEnv: { STUB_PI_TURNS: "6", STUB_PI_TURN_DELAY_MS: "10" },
  });
  harness.github.addIssue({ number: 21, title: "Long running task", body: "Do a lot of work.", labels: ["agent:run"] });
  const issue = harness.github.issues.get(21);
  assert.ok(issue !== undefined);

  // The fourth issue read is the first boundary; post the halt right then.
  harness.github.onGetIssue = (_issue, callCount) => {
    if (callCount === 4) {
      harness.github.addComment(21, {
        login: "maintainer",
        body: "/agent halt\nStop after this boundary.",
        at: new Date(Date.now() + 1000).toISOString(),
      });
    }
  };

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

  const result = await harness.orchestrator.run(trigger);
  assert.equal(result.status, "halted");

  const feedback = harness.github.markerComments(21, "feedback")[0]?.body ?? "";
  assert.match(feedback, /Stopping at an action boundary/);
  assert.match(feedback, /\*\*Completed\*\*/);
  assert.match(feedback, /\*\*Not done\*\*/);
  assert.match(feedback, /\*\*State to resume from\*\*/);
  assert.match(feedback, /Consumed so far/);

  const decision = harness.github.markerComments(21, "decision")[0]?.body ?? "";
  assert.match(decision, /Decision recorded: `halt`/);
  assert.match(decision, /at boundary/);

  assert.deepEqual(harness.github.labelsOf(21).sort(), ["agent:halted", "agent:run"]);

  const log = readFileSync(stubLogPath(harness), "utf8");
  const records = log
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { type: string; event?: string; command?: { type: string } });

  const indicesOf = (predicate: (record: { type: string; event?: string; command?: { type: string } }) => boolean) =>
    records.flatMap((record, index) => (predicate(record) ? [index] : []));
  const turnEnds = indicesOf((record) => record.type === "event" && record.event === "turn_end");
  const stateChecks = indicesOf((record) => record.type === "command" && record.command?.type === "get_state");
  const aborts = indicesOf((record) => record.type === "command" && record.command?.type === "abort");

  assert.ok(turnEnds.length >= 1, "a turn must have completed");
  const firstTurnEnd = turnEnds[0];
  const lastStateCheck = stateChecks[stateChecks.length - 1];
  const abortIndex = aborts[0];
  assert.ok(firstTurnEnd !== undefined && lastStateCheck !== undefined && abortIndex !== undefined);
  assert.ok(lastStateCheck > firstTurnEnd, "get_state is used to confirm the interruption point after a turn");
  assert.ok(abortIndex > lastStateCheck, "abort happens after the state check");

  const steering = records.filter(
    (record) => record.type === "command" && ["steer", "follow_up"].includes(record.command?.type ?? ""),
  );
  assert.deepEqual(steering, [], "the orchestrator never queues steering or follow-up");

  // No further turns were consumed after the abort.
  const laterTurnEnds = records
    .slice(abortIndex)
    .filter((record) => record.type === "event" && record.event === "turn_end");
  assert.deepEqual(laterTurnEnds, []);
});

test("a halt request on an idle issue changes nothing", async () => {
  const harness = makeHarness({ workspace: fakeWorkspaceState([]) });
  harness.github.addIssue({ number: 22, title: "Idle", body: "Nothing running." });
  const result = await harness.orchestrator.handleCommand({
    issue: harness.github.issues.get(22),
    comment: {
      id: 5001,
      body: "/agent halt",
      user: { login: "maintainer" },
      created_at: "2026-10-26T10:00:00.000Z",
    },
  });
  assert.equal(result.status, "ignored");
  assert.equal(harness.github.markerComments(22, "decision").length, 0);
  assert.match(harness.github.commentsFor(22)[0]?.body ?? "", /Nothing to halt/);
});

test("a halt from an account without write access is ignored with an explanation", async () => {
  const harness = makeHarness();
  harness.github.addIssue({ number: 23, title: "Busy", body: "Working." });
  await harness.github.addLabels(23, ["agent:run", "agent:working"]);
  const result = await harness.orchestrator.handleCommand({
    issue: harness.github.issues.get(23),
    comment: {
      id: 5002,
      body: "/agent halt",
      user: { login: "reader" },
      created_at: "2026-10-26T10:00:00.000Z",
    },
  });
  assert.equal(result.status, "denied");
  assert.match(harness.github.commentsFor(23)[0]?.body ?? "", /write access/);
  assert.equal(harness.github.markerComments(23, "decision").length, 0);
});

test("a repository-wide halt blocks new work until it is lifted", async () => {
  const harness = makeHarness({ workspace: fakeWorkspaceState([]) });

  // The dedicated halt issue rests in `halted`, which is what makes the halt active.
  harness.github.addIssue({
    number: 1,
    title: "Repository-wide agent halt",
    body: "Used to stop all agent work.",
    labels: ["agent:run", "agent:halted"],
  });
  harness.github.addComment(1, {
    login: "agent",
    body: [
      "<!-- agent:status issue=1 -->",
      "**State:** `halted` — work was stopped and can be resumed with a command.",
      "",
      "| At | State | Run | Consumed | Next act |",
      "|----|-------|-----|----------|----------|",
      "| 2026-10-26T09:50:00.000Z | `halted` | `run-halt` | $0.00 | post `/agent retry` |",
    ].join("\n"),
  });

  harness.github.addIssue({
    number: 24,
    title: "New work",
    body: "Do something.",
    labels: ["agent:run"],
  });
  const issue = harness.github.issues.get(24);
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

  const result = await harness.orchestrator.run(trigger);
  assert.equal(result.status, "halted");
  assert.equal(harness.github.markerComments(24, "ack").length, 0);
  assert.match(harness.github.commentsFor(24)[0]?.body ?? "", /repository-wide halt is active/);

  // Lifting the halt on the dedicated issue allows work again.
  const lifted = await harness.orchestrator.handleCommand({
    issue: harness.github.issues.get(1),
    comment: {
      id: 7001,
      body: "/agent continue",
      user: { login: "maintainer" },
      created_at: new Date().toISOString(),
    },
  });
  assert.equal(lifted.status, "waiting");
  assert.match(
    harness.github.commentsFor(1).map((comment) => comment.body ?? "").join("\n"),
    /Global halt lifted/,
  );
});
