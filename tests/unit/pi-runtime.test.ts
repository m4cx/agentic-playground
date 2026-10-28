import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertOrchestratorPrivilege,
  assertPiRuntime,
  egressUidFromEnvironment,
  packageRootFor,
  PiRuntimeError,
  readAgentEnvFile,
  readPinnedPiVersion,
  resolvePiRuntime,
} from "../../src/agent/pi-runtime.js";

const repoRoot = process.cwd();

test("the repository pin resolves from node_modules without PATH", () => {
  assert.equal(readPinnedPiVersion(repoRoot), "1.4.0");
  const runtime = resolvePiRuntime(repoRoot);
  assert.equal(runtime.version, "1.4.0");
  assert.equal(runtime.nodePath, process.execPath);
  assert.ok(runtime.entry.startsWith(join(repoRoot, "node_modules")));
  assert.ok(readFileSync(runtime.entry, "utf8").length > 0);
});

test("a valid runtime passes the pure validation", () => {
  const runtime = resolvePiRuntime(repoRoot);
  const packageRoot = packageRootFor(runtime.entry);
  const validated = assertPiRuntime({
    repoRoot,
    packageRoot,
    entry: runtime.entry,
    installedVersion: "1.4.0",
    pinnedVersion: "1.4.0",
    lockedVersion: "1.4.0",
  });
  assert.deepEqual(validated, runtime);
});

test("a ranged pin, mismatched versions, a missing entry, and an outside entry all fail closed", () => {
  const runtime = resolvePiRuntime(repoRoot);
  const packageRoot = packageRootFor(runtime.entry);
  const base = {
    repoRoot,
    packageRoot,
    entry: runtime.entry,
    installedVersion: "1.4.0",
    pinnedVersion: "1.4.0",
    lockedVersion: "1.4.0",
  };
  const outside = join(tmpdir(), `outside-${process.pid}.js`);
  writeFileSync(outside, "// outside\n");

  for (const parts of [
    { ...base, pinnedVersion: "^1.4.0" },
    { ...base, installedVersion: "1.4.1" },
    { ...base, lockedVersion: "1.4.1" },
    { ...base, entry: join(tmpdir(), "missing-pi-entry.js") },
    { ...base, entry: outside },
  ]) {
    assert.throws(() => assertPiRuntime(parts), (error: unknown) => {
      assert.ok(error instanceof PiRuntimeError);
      assert.equal(error.reason, "environment");
      return true;
    });
  }
});

test("the egress uid is parsed strictly", () => {
  assert.equal(egressUidFromEnvironment({}), undefined);
  assert.equal(egressUidFromEnvironment({ AGENT_EGRESS_UID: "1500" }), 1500);
  for (const value of ["", "abc", "0", "-1", "1.5"]) {
    assert.throws(() => egressUidFromEnvironment({ AGENT_EGRESS_UID: value }), PiRuntimeError);
  }
});

test("dropping to the egress uid requires root", () => {
  assert.doesNotThrow(() => assertOrchestratorPrivilege(undefined, () => 1001));
  assert.doesNotThrow(() => assertOrchestratorPrivilege(1500, () => 0));
  assert.throws(
    () => assertOrchestratorPrivilege(1500, () => 1001),
    /not uid 0.*sudo/,
  );
});

test("the secret env file is read once, allowlisted, and unlinked", () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-env-"));
  const path = join(directory, "agent.env");
  writeFileSync(path, "GITHUB_TOKEN=ghp-secret\nOLLAMA_API_KEY=ollama-secret\n", { mode: 0o600 });
  chmodSync(path, 0o600);
  const values = readAgentEnvFile(path);
  assert.deepEqual(values, { GITHUB_TOKEN: "ghp-secret", OLLAMA_API_KEY: "ollama-secret" });
  assert.equal(exists(path), false);
});

test("a secret env file with the wrong mode or an unexpected key is refused", () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-env-"));
  const wrongMode = join(directory, "wrong-mode.env");
  writeFileSync(wrongMode, "GITHUB_TOKEN=value\n", { mode: 0o644 });
  chmodSync(wrongMode, 0o644);
  assert.throws(() => readAgentEnvFile(wrongMode), /mode 0600/);

  const unexpected = join(directory, "unexpected.env");
  writeFileSync(unexpected, "SURPRISE=value\n", { mode: 0o600 });
  chmodSync(unexpected, 0o600);
  assert.throws(() => readAgentEnvFile(unexpected), /unexpected key/);
});

function exists(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}
