import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { loadConfig } from "../../src/agent/config.js";
import { PiSession, type SpawnLike } from "../../src/agent/pi-session.js";

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 4242;
  exitCode: number | null = 0;
  killed: NodeJS.Signals | false = false;

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = signal ?? false;
    return true;
  }
}

test("Pi is launched as node + the resolved entry, never as a bare `pi`", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "agent-launch-"));
  const sessionDir = mkdtempSync(join(tmpdir(), "agent-launch-sessions-"));
  const child = new FakeChild();
  const calls: Array<{ command: string; args: readonly string[]; options: Record<string, unknown> }> = [];
  const spawnImpl: SpawnLike = (command, args, options) => {
    calls.push({ command, args, options });
    return child as unknown as ReturnType<SpawnLike>;
  };
  const runtime = {
    nodePath: "/usr/bin/node",
    entry: "/repo/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
    version: "1.4.0",
  };

  const session = new PiSession({
    config: loadConfig(process.cwd()).config,
    repoRoot,
    issueNumber: 7,
    fingerprint: "abc123",
    sessionDir,
    runtime,
    spawnImpl,
    env: {
      PATH: "/usr/bin",
      GITHUB_TOKEN: "must-not-reach-pi",
      OLLAMA_API_KEY: "provider-key",
    },
  });

  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call !== undefined);
  assert.equal(call.command, runtime.nodePath);
  assert.equal(call.args[0], runtime.entry);
  assert.ok(call.args.includes("--mode"));
  assert.equal(call.args[call.args.indexOf("--mode") + 1], "rpc");
  assert.equal(call.command === "pi", false);
  assert.equal(call.options["detached"], true);
  const env = call.options["env"] as NodeJS.ProcessEnv;
  assert.equal(env["GITHUB_TOKEN"], undefined);
  assert.equal(env["OLLAMA_API_KEY"], "provider-key");
  assert.ok((env["HOME"] ?? "").startsWith(sessionDir));
  assert.ok((env["TMPDIR"] ?? "").startsWith(sessionDir));
  assert.equal(env["PI_CODING_AGENT_DIR"], join(sessionDir, "pi-agent"));
  assert.equal(session.piVersion, "1.4.0");

  await session.dispose();
});

test("the reviewed provider definitions are installed into Pi's agent directory", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "agent-launch-models-"));
  mkdirSync(join(repoRoot, ".agent"), { recursive: true });
  const models = JSON.stringify({ providers: { "ollama-cloud": { baseUrl: "https://ollama.com/v1" } } });
  writeFileSync(join(repoRoot, ".agent", "models.json"), `${models}\n`);
  const sessionDir = mkdtempSync(join(tmpdir(), "agent-launch-models-sessions-"));
  const child = new FakeChild();
  const calls: Array<{ options: Record<string, unknown> }> = [];
  const spawnImpl: SpawnLike = (_command, _args, options) => {
    calls.push({ options });
    return child as unknown as ReturnType<SpawnLike>;
  };

  const session = new PiSession({
    config: loadConfig(process.cwd()).config,
    repoRoot,
    issueNumber: 9,
    fingerprint: "abc123",
    sessionDir,
    runtime: { nodePath: "/usr/bin/node", entry: "/repo/pi.js", version: "1.4.0" },
    spawnImpl,
    env: { PATH: "/usr/bin", OLLAMA_API_KEY: "provider-key" },
  });

  const env = calls[0]?.options["env"] as NodeJS.ProcessEnv;
  assert.equal(env["PI_CODING_AGENT_DIR"], join(sessionDir, "pi-agent"));
  assert.equal(readFileSync(join(sessionDir, "pi-agent", "models.json"), "utf8"), `${models}\n`);

  await session.dispose();
});

test("teardown reaps the egress uid after the process group is killed", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "agent-reap-"));
  const sessionDir = mkdtempSync(join(tmpdir(), "agent-reap-sessions-"));
  const child = new FakeChild();
  const reaped: number[] = [];
  const spawnImpl: SpawnLike = () => child as unknown as ReturnType<SpawnLike>;

  const session = new PiSession({
    config: loadConfig(process.cwd()).config,
    repoRoot,
    issueNumber: 8,
    fingerprint: "abc123",
    sessionDir,
    runtime: { nodePath: process.execPath, entry: "/repo/node_modules/pi/cli.js", version: "1.4.0" },
    spawnImpl,
    egressUid: 1500,
    reapProcesses: (uid) => {
      reaped.push(uid);
    },
    env: { PATH: "/usr/bin", OLLAMA_API_KEY: "provider-key" },
  });

  await session.dispose();
  assert.deepEqual(reaped, [1500]);
});
