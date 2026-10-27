import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadConfig } from "../../src/agent/config.js";
import { Workspace } from "../../src/agent/workspace.js";

const proposal = loadConfig(process.cwd()).config.proposal;

function makeWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "agent-git-worktree-"));
  const gitDir = mkdtempSync(join(tmpdir(), "agent-git-dir-"));
  mkdirSync(gitDir, { recursive: true });
  writeFileSync(join(gitDir, "config"), "[core]\n\trepositoryformatversion = 0\n");
  const calls: Array<{ args: string[]; env?: NodeJS.ProcessEnv }> = [];
  const workspace = new Workspace({
    repoRoot: root,
    defaultBranch: "HEAD",
    issueNumber: 12,
    proposal,
    secrets: [],
    gitDir,
    runGit: async (args, options) => {
      calls.push({ args, ...(options?.env === undefined ? {} : { env: options.env }) });
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  return { root, gitDir, calls, workspace };
}

test("git runs against the separate GIT_DIR with hooks disabled", async () => {
  const { root, gitDir, calls, workspace } = makeWorkspace();
  await workspace.createBranch("Fix the bug");
  await workspace.commit("agent: fix the bug (#12)");

  const switchCall = calls.find((call) => call.args.includes("switch"));
  assert.ok(switchCall !== undefined);
  assert.deepEqual(switchCall.args.slice(0, 7), [
    "--git-dir",
    gitDir,
    "--work-tree",
    root,
    "-c",
    `safe.directory=${root}`,
    "-c",
  ]);
  assert.equal(switchCall.args[7], "core.hooksPath=/dev/null");

  const commitCall = calls.find((call) => call.args.includes("commit"));
  assert.ok(commitCall !== undefined);
  assert.ok(commitCall.args.includes("--no-verify"));
});

test("the push credential travels in the git environment, not in argv", async () => {
  const { calls, workspace } = makeWorkspace();
  await workspace.createBranch("Fix the bug");
  await workspace.pushWithCredential("push-token-value");
  const pushCall = calls.find((call) => call.args.includes("push"));
  assert.ok(pushCall !== undefined);
  assert.equal(pushCall.args.join(" ").includes("push-token-value"), false);
  assert.equal(pushCall.args.includes("http.extraheader"), false);
  assert.equal(pushCall.env?.["GIT_CONFIG_COUNT"], "1");
  assert.equal(pushCall.env?.["GIT_CONFIG_KEY_0"], "http.extraheader");
  assert.match(pushCall.env?.["GIT_CONFIG_VALUE_0"] ?? "", /AUTHORIZATION: basic /);
});

test("the clean-config assertion reads the separate GIT_DIR", async () => {
  const { gitDir, workspace } = makeWorkspace();
  await workspace.assertNoCredentialInGitConfig();
  writeFileSync(join(gitDir, "config"), "[http]\n\textraheader = AUTHORIZATION: basic abc\n");
  await assert.rejects(() => workspace.assertNoCredentialInGitConfig(), /contains a credential/);
});
