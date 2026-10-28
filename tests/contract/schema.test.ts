import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadConfig, validateModels } from "../../src/agent/config.js";
import { parseAgentOutput } from "../../src/agent/output.js";
import { createSession, createStateRecord, renderStateMarker, validateStateRecord } from "../../src/agent/state.js";

const root = process.cwd();

test("the repository configuration satisfies the contract", () => {
  const loaded = loadConfig(root);
  assert.equal(loaded.config.version, 1);
  assert.equal(loaded.config.triggerLabel, "agent:run");
  assert.equal(loaded.config.resumeCommand, "/agent continue");
  assert.equal(loaded.config.slugMaxLength, 50);
  assert.equal(loaded.config.network.allowHosts.length, 2);
  assert.equal(loaded.fingerprint.length, 8);
});

test("the repository models file satisfies the contract", () => {
  const raw = JSON.parse(
    readFileSync(path.join(root, ".agent", "models.json"), "utf8"),
  ) as unknown;
  const models = validateModels(raw);
  assert.ok(models.providers["ollama-cloud"]?.models?.some((model) => model.id === "kimi-k2.7-code"));
  assert.equal(models.providers["ollama-cloud"]?.apiKey, "$OLLAMA_API_KEY");
});

test("state schema is exactly version 1", () => {
  const trigger = {
    kind: "label" as const,
    actor: "maintainer",
    permission: "write" as const,
    at: "2026-10-28T10:00:00Z",
    commentId: null,
    commandText: null,
    labelName: "agent:run",
  };
  const session = createSession({
    issueNumber: 42,
    title: "Fix login timeout",
    trigger,
    now: "2026-10-28T10:00:00Z",
    slugMaxLength: 50,
    fingerprint: "a1b2c3d4",
    requestVersion: "sha256:abc",
  });
  const record = createStateRecord(session, "run-1");
  assert.equal(record.schema, 1);
  assert.equal(validateStateRecord(JSON.parse(JSON.stringify(record))).schema, 1);
  assert.match(renderStateMarker(record), /agent-session-state/);
});

test("agent output schema matches the contract", () => {
  const text = [
    "```json",
    JSON.stringify({
      summary: "Implemented the change.",
      verification: ["npm test — passed"],
      openQuestions: [],
      couldNotComplete: [],
      prTitle: "Implement the change",
      prBody: "This implements the change.",
      state: "finished",
    }),
    "```",
  ].join("\n");
  const output = parseAgentOutput(text);
  assert.equal(output.state, "finished");
  assert.equal(output.summary, "Implemented the change.");
  assert.equal(output.verification.length, 1);
});

test("the event fixtures are valid JSON", () => {
  for (const file of [
    "issues-labeled.json",
    "issue-comment-resume.json",
    "pull-request-merged.json",
    "pull-request-closed.json",
    "issue-closed.json",
  ]) {
    const raw = readFileSync(path.join(root, "tests", "fixtures", "events", file), "utf8");
    assert.doesNotThrow(() => JSON.parse(raw), file);
  }
});
