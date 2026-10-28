import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const config = JSON.parse(
  readFileSync(path.join(root, ".agent", "config.json"), "utf8"),
) as { triggerLabel: string; resumeCommand: string };
const runWorkflow = readFileSync(
  path.join(root, ".github", "workflows", "agent-run.yml"),
  "utf8",
);
const resumeWorkflow = readFileSync(
  path.join(root, ".github", "workflows", "agent-resume.yml"),
  "utf8",
);

test("trigger label matches between config and agent-run workflow", () => {
  assert.ok(
    runWorkflow.includes(`github.event.label.name == '${config.triggerLabel}'`),
    `agent-run.yml must filter on ${config.triggerLabel}`,
  );
});

test("resume command matches between config and agent-resume workflow", () => {
  assert.ok(
    resumeWorkflow.includes(`startsWith(github.event.comment.body, '${config.resumeCommand}')`),
    `agent-resume.yml must filter on ${config.resumeCommand}`,
  );
});

test("agent workflows share the per-issue concurrency group", () => {
  assert.match(runWorkflow, /group: agent-issue-\$\{\{ github\.event\.issue\.number \}\}/);
  assert.match(resumeWorkflow, /group: agent-issue-\$\{\{ github\.event\.issue\.number \}\}/);
});

test("agent workflows request the required permissions", () => {
  for (const workflow of [runWorkflow, resumeWorkflow]) {
    assert.match(workflow, /contents: write/);
    assert.match(workflow, /issues: write/);
    assert.match(workflow, /pull-requests: write/);
  }
});

test("agent workflows do not cancel in-flight runs", () => {
  assert.match(runWorkflow, /cancel-in-progress: false/);
  assert.match(resumeWorkflow, /cancel-in-progress: false/);
});
