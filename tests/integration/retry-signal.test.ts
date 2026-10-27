import assert from "node:assert/strict";
import test from "node:test";

import { parseIssueTrigger } from "../../src/agent/events.js";
import { makeHarness } from "../fake-github.js";

test("a summarization retry signal aborts the run and fails it with unexpected-retry", async () => {
  const harness = makeHarness({
    stubEnv: { STUB_PI_RETRY_SIGNAL: "summarization_retry_scheduled", STUB_PI_TURNS: "4" },
  });
  harness.github.addIssue({ number: 41, title: "Long conversation", body: "Keep going.", labels: ["agent:run"] });
  const issue = harness.github.issues.get(41);
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
  assert.equal(result.status, "failed");
  assert.equal(result.failureReason, "unexpected-retry");

  const error = harness.github.markerComments(41, "error")[0]?.body ?? "";
  assert.match(error, /`unexpected-retry`/);
  assert.match(error, /summarization_retry_scheduled/);
  assert.match(error, /Can you fix it\?/);
  assert.deepEqual(harness.github.labelsOf(41).sort(), ["agent:failed", "agent:run"]);

  // Exactly one attempt: one acknowledgement, one error, no second run.
  assert.equal(harness.github.markerComments(41, "ack").length, 1);
  assert.equal(harness.github.markerComments(41, "error").length, 1);
  assert.equal(harness.github.markerComments(41, "result").length, 0);
});

test("willRetry on agent_end is treated as a retry signal too", async () => {
  const harness = makeHarness({
    stubEnv: { STUB_PI_WILL_RETRY: "1", STUB_PI_TURNS: "1" },
  });
  harness.github.addIssue({ number: 42, title: "Retry by harness", body: "Work.", labels: ["agent:run"] });
  const issue = harness.github.issues.get(42);
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
  assert.equal(result.failureReason, "unexpected-retry");
});
