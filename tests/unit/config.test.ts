import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  computeFingerprint,
  ConfigError,
  loadConfig,
  parseConfigYaml,
  shortHash,
  validateConfig,
} from "../../src/agent/config.js";

function fixtureRepo(mutate?: (config: string) => string, instructions = "# Rules\n\nBe careful.\n"): string {
  const root = mkdtempSync(join(tmpdir(), "agent-config-"));
  mkdirSync(join(root, ".agent"), { recursive: true });
  mkdirSync(join(root, ".pi", "prompts"), { recursive: true });
  writeFileSync(join(root, ".pi", "prompts", "speckit.specify.md"), "# specify\n");
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ dependencies: { "@earendil-works/pi-coding-agent": "1.4.0" } }),
  );
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify({ packages: { "node_modules/@earendil-works/pi-coding-agent": { version: "1.4.0" } } }),
  );
  const config = baseYaml();
  writeFileSync(join(root, ".agent", "config.yml"), mutate === undefined ? config : mutate(config));
  writeFileSync(join(root, ".agent", "instructions.md"), instructions);
  writeFileSync(
    join(root, ".agent", "models.json"),
    JSON.stringify({ providers: { "ollama-cloud": { baseUrl: "https://ollama.com/v1" } } }),
  );
  return root;
}

function baseYaml(): string {
  return [
    'model: "ollama-cloud/kimi-k2.7-code"',
    "thinking: high",
    "tools:",
    "  - read",
    "  - bash",
    "promptTemplates:",
    "  - .pi/prompts/speckit.specify.md",
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
    "    - ollama.com",
    "sweep:",
    "  graceMinutes: 90",
    "",
  ].join("\n");
}

test("parses the repository's own configuration", () => {
  const loaded = loadConfig(process.cwd());
  assert.equal(loaded.config.model, "ollama-cloud/kimi-k2.7-code");
  assert.equal(loaded.config.thinking, "high");
  assert.ok(loaded.config.tools.includes("read"));
  assert.ok(loaded.config.promptTemplates.length >= 3);
  assert.equal(loaded.fingerprint.length, 64);
  assert.equal(shortHash(loaded.fingerprint).length, 12);
});

test("parses nested mappings and sequences", () => {
  const parsed = parseConfigYaml("a:\n  b: 1\n  c:\n    - x\n    - y\n");
  assert.deepEqual(parsed, { a: { b: 1, c: ["x", "y"] } });
});

test("missing configuration file fails closed", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-config-missing-"));
  assert.throws(() => loadConfig(root), (error: unknown) => {
    assert.ok(error instanceof ConfigError);
    assert.match(error.message, /missing/);
    return true;
  });
});

test("unknown key fails closed and names the key", () => {
  const root = fixtureRepo((config) => `${config}surprise: true\n`);
  assert.throws(() => loadConfig(root), (error: unknown) => {
    assert.ok(error instanceof ConfigError);
    assert.match(error.message, /unknown configuration key: surprise/);
    return true;
  });
});

test("duplicate key is rejected by the parser", () => {
  assert.throws(() => parseConfigYaml("a: 1\na: 2\n"), /duplicate key/);
});

test("warnAtRatio must be strictly between 0 and 1", () => {
  for (const value of ["0", "1"]) {
    const root = fixtureRepo((config) => config.replace("warnAtRatio: 0.8", `warnAtRatio: ${value}`));
    assert.throws(() => loadConfig(root), /0 < r < 1/);
  }
});

test("missing template path fails before any model call", () => {
  const root = fixtureRepo((config) =>
    config.replace(".pi/prompts/speckit.specify.md", ".pi/prompts/speckit.missing.md"),
  );
  assert.throws(() => loadConfig(root), /does not exist on the trusted ref/);
});

test("a template path outside the repository fails", () => {
  const root = fixtureRepo((config) =>
    config.replace(".pi/prompts/speckit.specify.md", "../outside.md"),
  );
  assert.throws(() => loadConfig(root), /not repository-relative/);
});

test("a non-markdown template path fails", () => {
  const root = fixtureRepo((config) =>
    config.replace(".pi/prompts/speckit.specify.md", ".pi/prompts/speckit.specify.txt"),
  );
  assert.throws(() => loadConfig(root), /must end in \.md/);
});

test("an unknown tool fails and a git tool is refused", () => {
  const unknown = fixtureRepo((config) => config.replace("  - bash", "  - teleport"));
  assert.throws(() => loadConfig(unknown), /unknown tool: teleport/);

  const gitTool = fixtureRepo((config) => config.replace("  - bash", "  - git-push"));
  assert.throws(() => loadConfig(gitTool), /unknown tool: git-push/);
});

test("the request label must not collide with a state label", () => {
  const root = fixtureRepo((config) => config.replace('request: "agent:run"', 'request: "agent:working"'));
  assert.throws(() => loadConfig(root), /must not collide with a state label/);
});

test("an empty egress allowlist fails closed", () => {
  const root = fixtureRepo((config) => config.replace("    - ollama.com", "    - \u0022\u0022"));
  assert.throws(() => loadConfig(root), /network\.allowHosts/);
});

test("missing provider definitions fail closed and name the file", () => {
  const root = fixtureRepo();
  rmSync(join(root, ".agent", "models.json"));
  assert.throws(() => loadConfig(root), (error: unknown) => {
    assert.ok(error instanceof ConfigError);
    assert.equal(error.key, ".agent/models.json");
    assert.match(error.message, /provider definitions are missing/);
    return true;
  });
});

test("the sweep window must exceed the run timeout", () => {
  const root = fixtureRepo((config) => config.replace("graceMinutes: 90", "graceMinutes: 10"));
  assert.throws(() => loadConfig(root), /comfortably larger/);
});

test("the fingerprint changes for each of its inputs", () => {
  const base = {
    instructions: "instructions",
    model: "ollama-cloud/kimi-k2.7-code",
    thinking: "high",
    tools: ["read", "bash"],
    promptTemplates: [".pi/prompts/speckit.specify.md"],
    piVersion: "1.4.0",
  };
  const original = computeFingerprint(base);
  assert.notEqual(computeFingerprint({ ...base, instructions: "changed" }), original);
  assert.notEqual(computeFingerprint({ ...base, model: "other/model" }), original);
  assert.notEqual(computeFingerprint({ ...base, thinking: "low" }), original);
  assert.notEqual(computeFingerprint({ ...base, tools: ["read"] }), original);
  assert.notEqual(
    computeFingerprint({ ...base, promptTemplates: [".pi/prompts/speckit.plan.md"] }),
    original,
  );
  assert.notEqual(computeFingerprint({ ...base, piVersion: "1.4.1" }), original);
  assert.equal(computeFingerprint({ ...base, tools: ["read", "bash"] }), original);
});

test("a missing or ranged Pi pin fails closed", () => {
  const root = fixtureRepo();
  rmSync(join(root, "package.json"));
  assert.throws(() => loadConfig(root), /package\.json is missing/);

  const ranged = fixtureRepo((config) => config);
  writeFileSync(
    join(ranged, "package.json"),
    JSON.stringify({ dependencies: { "@earendil-works/pi-coding-agent": "^1.4.0" } }),
  );
  assert.throws(() => loadConfig(ranged), /must be an exact version/);
});

test("validation can be exercised without touching the filesystem", () => {
  const parsed = parseConfigYaml(baseYaml());
  const result = validateConfig(parsed, {
    instructionsContent: "x",
    fileExists: (path) => path !== "../outside.md",
  });
  assert.equal(result.config.limits.maxTurns, 40);
  assert.equal(result.instructionsHash.length, 64);
});
