import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  prepareAgentWorkspace,
  verifyEgressBoundaries,
  type EgressProbeResult,
} from "../../src/agent/workspace.js";

const PASS: EgressProbeResult = {
  workTreeWritable: true,
  gitDirReadable: false,
  gitDirWritable: false,
  dotGitPresent: false,
  nodeModulesWritable: false,
  entryReadable: true,
  nodeExecutable: true,
  sessionWritable: true,
};

test("the accepted egress boundary is exactly: writable work tree, unreachable git", () => {
  assert.doesNotThrow(() => verifyEgressBoundaries(PASS));
});

test("every inverted boundary fails with environment", () => {
  const cases: Array<[EgressProbeResult, RegExp]> = [
    [{ ...PASS, workTreeWritable: false }, /cannot write the work tree/],
    [{ ...PASS, gitDirReadable: true }, /can reach GIT_DIR/],
    [{ ...PASS, gitDirWritable: true }, /can reach GIT_DIR/],
    [{ ...PASS, dotGitPresent: true }, /still contains a \.git entry/],
    [{ ...PASS, nodeModulesWritable: true }, /can write node_modules/],
    [{ ...PASS, entryReadable: false }, /cannot read the resolved Pi entry/],
    [{ ...PASS, nodeExecutable: false }, /cannot execute the Node binary/],
    [{ ...PASS, sessionWritable: false }, /cannot write the session cache directory/],
  ];
  for (const [probe, message] of cases) {
    assert.throws(() => verifyEgressBoundaries(probe), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, message);
      return true;
    });
  }
});

test("preparation moves .git out of the work tree and never chowns node_modules", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-worktree-"));
  const runTemp = mkdtempSync(join(tmpdir(), "agent-runtemp-"));
  const sessionDir = mkdtempSync(join(tmpdir(), "agent-session-"));
  mkdirSync(join(root, ".git"), { recursive: true });
  writeFileSync(join(root, ".git", "config"), "[core]\n\trepositoryformatversion = 0\n");
  mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(root, "node_modules", "pkg", "index.js"), "export {};\n");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.ts"), "export const a = 1;\n");

  const chowned: string[] = [];
  const prepared = prepareAgentWorkspace({
    repoRoot: root,
    runTemp,
    sessionDir,
    egressUid: 1500,
    probe: () => PASS,
    chown: (path) => {
      chowned.push(path);
    },
  });

  assert.equal(prepared.gitDir, join(runTemp, "agent-git"));
  assert.equal(existsSync(join(prepared.gitDir, "config")), true);
  assert.equal(existsSync(join(root, ".git")), false);
  assert.equal(existsSync(join(root, "node_modules", "pkg", "index.js")), true);
  assert.ok(chowned.includes(root));
  assert.ok(chowned.includes(join(root, "src")));
  assert.equal(
    chowned.some((path) => path.startsWith(join(root, "node_modules"))),
    false,
  );
});
