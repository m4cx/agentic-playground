import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  computeFingerprint,
  loadConfig,
  validateConfig,
  validateModels,
  type AgentConfig,
  type ModelsConfig,
} from "../../src/agent/config.js";

const validModels: ModelsConfig = {
  providers: {
    "ollama-cloud": {
      baseUrl: "https://ollama.com/v1",
      api: "openai-completions",
      apiKey: "$OLLAMA_API_KEY",
      models: [{ id: "kimi-k2.7-code" }],
    },
  },
};

function validRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    triggerLabel: "agent:run",
    resumeCommand: "/agent continue",
    slugMaxLength: 50,
    maxComments: 100,
    maxCommentCharacters: 8000,
    model: "ollama-cloud/kimi-k2.7-code",
    thinking: "high",
    tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
    instructionsPath: ".agent/instructions.md",
    agentDeadlineMinutes: 45,
    network: { allowHosts: ["ollama.com", "registry.npmjs.org"] },
    ...overrides,
  };
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "agentic-config-"));
  tempDirs.push(dir);
  mkdirSync(path.join(dir, ".agent"), { recursive: true });
  writeFileSync(path.join(dir, ".agent", "config.json"), JSON.stringify(validRaw()));
  writeFileSync(path.join(dir, ".agent", "models.json"), JSON.stringify(validModels));
  writeFileSync(path.join(dir, ".agent", "instructions.md"), "instructions");
  return dir;
}

test("valid config passes", () => {
  const config = validateConfig(validRaw(), validModels, "instructions");
  assert.equal(config.triggerLabel, "agent:run");
  assert.equal(config.tools.length, 7);
});

test("unknown key is rejected", () => {
  assert.throws(
    () => validateConfig(validRaw({ extra: true }), validModels, "instructions"),
    /unknown key/,
  );
});

test("invalid ranges are rejected", () => {
  const cases: Array<[string, unknown]> = [
    ["version", 2],
    ["slugMaxLength", 51],
    ["maxComments", 0],
    ["maxCommentCharacters", 100],
    ["agentDeadlineMinutes", 121],
    ["thinking", "extreme"],
    ["tools", []],
    ["tools", ["read", "read"]],
    ["tools", ["git"]],
    ["resumeCommand", "agent continue"],
    ["triggerLabel", "-bad"],
  ];
  for (const [key, value] of cases) {
    assert.throws(
      () => validateConfig(validRaw({ [key]: value }), validModels, "instructions"),
      /config:/,
      `${key} should be rejected`,
    );
  }
});

test("model must exist in models.json", () => {
  assert.throws(
    () => validateConfig(validRaw({ model: "ollama-cloud/unknown" }), validModels, "instructions"),
    /not defined/,
  );
});

test("provider host must be allowlisted", () => {
  assert.throws(
    () =>
      validateConfig(
        validRaw({ network: { allowHosts: ["registry.npmjs.org"] } }),
        validModels,
        "instructions",
      ),
    /provider host/,
  );
});

test("models validation rejects unknown provider keys", () => {
  assert.throws(
    () =>
      validateModels({
        providers: { "ollama-cloud": { baseUrl: "https://ollama.com", unknown: true } },
      }),
    /unknown key/,
  );
});

test("loadConfig reads files and fingerprints instructions changes", () => {
  const dir = makeRepo();
  const first = loadConfig(dir);
  assert.equal(first.config.model, "ollama-cloud/kimi-k2.7-code");
  writeFileSync(path.join(dir, ".agent", "instructions.md"), "different instructions");
  const second = loadConfig(dir);
  assert.notEqual(first.fingerprint, second.fingerprint);
});

test("fingerprint is stable for equal configuration", () => {
  const config = validateConfig(validRaw(), validModels, "instructions") as AgentConfig;
  const one = computeFingerprint(config, validModels, "instructions");
  const two = computeFingerprint(config, validModels, "instructions");
  assert.equal(one, two);
  assert.equal(one.length, 8);
});
