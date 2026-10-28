import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  assertNoRepositoryCredentials,
  assertPiVersion,
  buildChildEnvironment,
  readPiVersion,
  resolvePiCli,
} from "../../src/agent/pi-runtime.js";
import { validateConfig, validateModels } from "../../src/agent/config.js";

const models = validateModels({
  providers: {
    "ollama-cloud": {
      baseUrl: "https://ollama.com/v1",
      api: "openai-completions",
      apiKey: "$OLLAMA_API_KEY",
      models: [{ id: "kimi-k2.7-code" }],
    },
  },
});

const config = validateConfig(
  {
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
  },
  models,
  "instructions",
);

test("resolves the pinned Pi CLI and version", () => {
  const root = process.cwd();
  assert.equal(readPiVersion(root), "1.4.0");
  assert.equal(assertPiVersion(root), "1.4.0");
  assert.equal(path.basename(resolvePiCli(root)), "cli.js");
});

test("child environment excludes repository credentials", () => {
  const previousToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "ghs_supersecretvalue";
  try {
    const env = buildChildEnvironment({
      runtime: {
        runtimeDir: "/tmp/runtime",
        homeDir: "/tmp/runtime/home",
        sessionDir: "/tmp/runtime/sessions",
        instructionsPath: "/tmp/runtime/.agent/instructions.md",
      },
      config,
      workspaceDir: "/tmp/workspace",
    });
    assert.equal(env.GITHUB_TOKEN, undefined);
    assert.equal(env.HOME, "/tmp/runtime/home");
    assert.equal(env.PI_CODING_AGENT_DIR, "/tmp/runtime/agent");
    assert.doesNotThrow(() => assertNoRepositoryCredentials(env));
  } finally {
    if (previousToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = previousToken;
    }
  }
});

test("assertNoRepositoryCredentials rejects leaked variables", () => {
  assert.throws(
    () => assertNoRepositoryCredentials({ GITHUB_TOKEN: "x" }),
    /must not contain GITHUB_TOKEN/,
  );
  assert.throws(
    () => assertNoRepositoryCredentials({ ACTIONS_RUNTIME_TOKEN: "x" }),
    /must not contain ACTIONS_RUNTIME_TOKEN/,
  );
});
