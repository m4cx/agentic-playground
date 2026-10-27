import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadConfig } from "../../src/agent/config.js";
import { parseCommand } from "../../src/agent/commands.js";
import { extractTemplatesUsed, shouldUseSpecKit } from "../../src/agent/main.js";

function repoWithTemplates(): string {
  const root = mkdtempSync(join(tmpdir(), "agent-templates-"));
  mkdirSync(join(root, ".agent"), { recursive: true });
  mkdirSync(join(root, ".pi", "prompts"), { recursive: true });
  for (const name of ["speckit.specify", "speckit.plan", "speckit.tasks"]) {
    writeFileSync(join(root, ".pi", "prompts", `${name}.md`), `# ${name}\n`);
  }
  writeFileSync(
    join(root, ".agent", "instructions.md"),
    "# Instructions\n",
  );
  writeFileSync(
    join(root, ".agent", "config.yml"),
    [
      'model: "anthropic/claude-sonnet-4-5"',
      "thinking: high",
      "tools:",
      "  - read",
      "promptTemplates:",
      "  - .pi/prompts/speckit.specify.md",
      "  - .pi/prompts/speckit.plan.md",
      "  - .pi/prompts/speckit.tasks.md",
      "instructionsPath: .agent/instructions.md",
      "labels:",
      '  request: "agent:run"',
      '  queued: "agent:queued"',
      '  working: "agent:working"',
      '  waiting: "agent:waiting"',
      '  halted: "agent:halted"',
      '  finished: "agent:finished"',
      '  failed: "agent:failed"',
      '  rejected: "agent:rejected"',
      '  proposal: "agent:proposal"',
      "globalHaltIssue: 1",
      "limits:",
      "  maxCostUsd: 5",
      "  warnAtRatio: 0.8",
      "  continueIncrementUsd: 2",
      "  maxTurns: 40",
      "  maxWallClockMinutes: 45",
      "  startDeadlineSeconds: 180",
      "proposal:",
      "  maxChangedPaths: 20",
      "  maxDiffLines: 1500",
      "continuity:",
      "  sessionCacheKeyPrefix: pi-session",
      "network:",
      "  allowHosts:",
      "    - api.anthropic.com",
      "sweep:",
      "  graceMinutes: 90",
      "",
    ].join("\n"),
  );
  return root;
}

test("only the configured templates are loaded", () => {
  const loaded = loadConfig(repoWithTemplates());
  assert.deepEqual(loaded.config.promptTemplates, [
    ".pi/prompts/speckit.specify.md",
    ".pi/prompts/speckit.plan.md",
    ".pi/prompts/speckit.tasks.md",
  ]);
  assert.equal(loaded.config.promptTemplates.includes(".pi/prompts/speckit.analyze.md"), false);
});

test("an empty allowlist is valid and means no slash commands at all", () => {
  const root = repoWithTemplates();
  const configPath = join(root, ".agent", "config.yml");
  const source = readFileSync(configPath, "utf8");
  writeFileSync(
    configPath,
    source.replace(/promptTemplates:\n(?:  - .*\n)+/, "promptTemplates: []\n"),
  );
  const loaded = loadConfig(root);
  assert.deepEqual(loaded.config.promptTemplates, []);
});

test("a non-allowlisted slash command stays plain text", () => {
  // The command grammar only knows /agent, so a slash command is never a decision.
  assert.equal(parseCommand("/speckit.analyze specs/001"), null);
  const parsed = parseCommand("/agent /speckit.analyze");
  assert.equal(parsed?.kind, "unknown");
});

test("the templates a run reports are the ones it invoked", () => {
  const answer = "I ran /speckit.specify and then /speckit.plan. agent-ignored: none";
  assert.deepEqual(extractTemplatesUsed(answer), ["/speckit.specify", "/speckit.plan"]);
  assert.deepEqual(extractTemplatesUsed("no templates here"), []);
});

test("the Spec Kit trigger is explicit or size-based, never guessed from language", () => {
  assert.equal(shouldUseSpecKit({ title: "Fix typo", body: "speckit: plan" }), "speckit.plan");
  assert.equal(shouldUseSpecKit({ title: "Fix typo", body: "small change" }), null);
  const large = `${"word ".repeat(400)}\nWe need a new cross-cutting feature.`;
  assert.equal(shouldUseSpecKit({ title: "New capability", body: large }), "speckit.specify");
});
