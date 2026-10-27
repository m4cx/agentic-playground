import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadConfig } from "../../src/agent/config.js";
import { GitHubClient, labelNames } from "../../src/agent/github.js";
import { PermissionGate } from "../../src/agent/permissions.js";
import {
  branchName,
  commitMessage,
  checkDiffBounds,
  isExcludedPath,
  scanForCredentials,
  Workspace,
} from "../../src/agent/workspace.js";
import {
  closeOutcome,
  issueNumberFromPullRequest,
  openProposal,
  proposalBody,
  proposalTitle,
  reviewDecision,
} from "../../src/agent/proposal.js";
import type { PullRequestPayload } from "../../src/agent/github.js";

const proposalConfig = loadConfig(process.cwd()).config.proposal;

test("branch names are lower-case ASCII with at most six words", () => {
  assert.equal(
    branchName(12, "Add a CONTRIBUTING guide for squash merges"),
    "agent/12-add-a-contributing-guide-for-squash",
  );
  assert.equal(branchName(12, "Über die Brücke"), "agent/12-uber-die-brucke");
  assert.equal(branchName(12, "修复登录问题"), "agent/12-issue-12");
});

test("a non-Latin title falls back to issue-<number>", () => {
  assert.equal(branchName(42, "新しい機能を追加する"), "agent/42-issue-42");
  assert.equal(branchName(42, "!!!"), "agent/42-issue-42");
});

test("an existing branch gets a numeric suffix instead of a force-push", () => {
  const first = "agent/12-fix-the-bug";
  assert.equal(branchName(12, "Fix the bug", [first]), `${first}-2`);
  assert.equal(branchName(12, "Fix the bug", [first, `${first}-2`]), `${first}-3`);
});

test("commit messages are English, bounded, and fall back safely", () => {
  const message = commitMessage("Add contributor guide", 12);
  assert.equal(message, "agent: Add contributor guide (#12)");
  assert.ok(message.length <= 72);
  const long = commitMessage("A".repeat(200), 12);
  assert.ok(long.length <= 72);
  assert.equal(commitMessage(null, 12), "agent: address issue 12 (#12)");
});

test("the diff bounds reject an unreviewable proposal", () => {
  const numstat = Array.from({ length: 25 }, (_, index) => `1\t0\tfile-${index}.txt`).join("\n");
  const byPaths = checkDiffBounds(numstat, proposalConfig);
  assert.equal(byPaths.tooLarge, true);
  assert.equal(byPaths.cause, "changed-paths");

  const manyLines = `100\t100\tbig.txt`;
  const byLines = checkDiffBounds(manyLines, { maxChangedPaths: 20, maxDiffLines: 100 });
  assert.equal(byLines.tooLarge, true);
  assert.equal(byLines.cause, "diff-lines");

  const fine = checkDiffBounds("2\t1\tREADME.md", proposalConfig);
  assert.equal(fine.tooLarge, false);
  assert.equal(fine.addedLines, 2);
  assert.equal(fine.removedLines, 1);
});

test("build output, sessions, and git metadata are excluded from a proposal", () => {
  for (const path of ["dist/src/agent/main.js", ".git/config", "pi-sessions/x.jsonl", "node_modules/x", "a.session.jsonl"]) {
    assert.equal(isExcludedPath(path), true, path);
  }
  assert.equal(isExcludedPath("src/agent/main.ts"), false);
});

test("a credential found before commit aborts the proposal", () => {
  const scan = scanForCredentials(
    [
      { path: "README.md", content: "fine content" },
      { path: "leak.txt", content: `token ghp_${"z".repeat(36)}` },
    ],
    [],
  );
  assert.equal(scan.detected, true);
  assert.deepEqual(scan.paths, ["leak.txt"]);
});

test("a detectable secret in a committed file aborts and is also recorded as redacted", () => {
  const scan = scanForCredentials([{ path: ".env", content: "API_TOKEN=abc123secretvalue" }], []);
  assert.equal(scan.detected, true);
  assert.deepEqual(scan.paths, [".env"]);
  assert.deepEqual(scan.redactedPaths, [".env"]);
});

test("the push carries the credential in git's environment, never in argv or config", async () => {
  const calls: Array<{ args: string[]; env?: NodeJS.ProcessEnv }> = [];
  const repoRoot = mkdtempSync(join(tmpdir(), "agent-worktree-"));
  const workspace = new Workspace({
    repoRoot,
    defaultBranch: "main",
    issueNumber: 12,
    proposal: proposalConfig,
    secrets: [],
    runGit: async (args, options) => {
      calls.push({ args, ...(options?.env === undefined ? {} : { env: options.env }) });
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  await workspace.createBranch("Fix the bug");
  await workspace.pushWithCredential("push-token-value");
  const pushCall = calls.find((call) => call.args.includes("push"));
  assert.ok(pushCall !== undefined);
  assert.equal(pushCall.args.join(" ").includes("push-token-value"), false);
  assert.equal(pushCall.args.includes("http.extraheader"), false);
  const base64 = Buffer.from("x-access-token:push-token-value", "utf8").toString("base64");
  assert.equal(pushCall.env?.["GIT_CONFIG_COUNT"], "1");
  assert.equal(pushCall.env?.["GIT_CONFIG_KEY_0"], "http.extraheader");
  assert.match(pushCall.env?.["GIT_CONFIG_VALUE_0"] ?? "", /AUTHORIZATION: basic /);
  assert.ok((pushCall.env?.["GIT_CONFIG_VALUE_0"] ?? "").includes(base64));
  assert.equal(pushCall.env?.["GITHUB_TOKEN"], undefined);
});

test("a failed push without a usable credential fails as environment", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "agent-worktree-"));
  const workspace = new Workspace({
    repoRoot,
    defaultBranch: "main",
    issueNumber: 12,
    proposal: proposalConfig,
    secrets: [],
    runGit: async () => ({ code: 0, stdout: "", stderr: "" }),
  });
  await workspace.createBranch("Fix the bug");
  await assert.rejects(() => workspace.pushWithCredential("  "), /no usable credential/);
});

test("the git config is asserted to be credential-free", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "agent-worktree-"));
  mkdirSync(join(repoRoot, ".git"), { recursive: true });
  writeFileSync(join(repoRoot, ".git", "config"), "[remote \"origin\"]\n\turl = https://example/repo\n");
  const workspace = new Workspace({
    repoRoot,
    defaultBranch: "main",
    issueNumber: 12,
    proposal: proposalConfig,
    secrets: [],
    runGit: async () => ({ code: 0, stdout: "", stderr: "" }),
  });
  await workspace.assertNoCredentialInGitConfig();
  writeFileSync(join(repoRoot, ".git", "config"), "[http]\n\textraheader = AUTHORIZATION: basic abc\n");
  await assert.rejects(() => workspace.assertNoCredentialInGitConfig(), /contains a credential/);
});

test("the GitHub client exposes no merge, approve, or force-push capability", () => {
  const methods = Object.getOwnPropertyNames(GitHubClient.prototype);
  for (const forbidden of ["merge", "approvePullRequest", "forcePush", "dismissReview", "release"]) {
    assert.equal(methods.includes(forbidden), false, `${forbidden} must not exist`);
  }
  assert.ok(methods.includes("createPullRequest"));
});

test("the proposal body links the issue and records the request version", () => {
  const body = proposalBody({
    issueNumber: 12,
    issueUrl: "https://github.com/example/repo/issues/12",
    summary: "Add a contributor guide.",
    changedPaths: ["CONTRIBUTING.md"],
    notDone: [],
    verification: ["documentation only"],
    requestVersion: "abc123",
    branch: "agent/12-add-a-contributor-guide",
    base: "main",
    templatesUsed: ["/speckit.specify"],
  });
  assert.match(body, /Closes #12/);
  assert.match(body, /Request version: `abc123`/);
  assert.match(body, /`CONTRIBUTING.md`/);
  assert.match(body, /nothing outstanding/);
  assert.match(body, /never merges/);
  assert.equal(proposalTitle("Add a contributor guide.", 12), "Add a contributor guide. (#12)");
});

test("the issue number is resolved from the body first, then the branch", () => {
  assert.equal(issueNumberFromPullRequest({ body: "Closes #31", head: { ref: "agent/99-x" } }), 31);
  assert.equal(issueNumberFromPullRequest({ body: "no link", head: { ref: "agent/42-fix" } }), 42);
  assert.equal(issueNumberFromPullRequest({ body: null, head: { ref: "unrelated" } }), null);
});

test("an approving review is a decision; a review from a reader is ignored", async () => {
  const permissions = new PermissionGate({
    async getCollaboratorPermission(login: string) {
      return { permission: login === "maintainer" ? "write" : "read" };
    },
  });
  const approved = await reviewDecision(
    { state: "APPROVED", user: { login: "maintainer" }, submitted_at: "2026-10-26T10:00:00.000Z" },
    permissions,
  );
  assert.equal(approved?.kind, "approve");
  assert.equal(approved?.recorded, true);

  const ignored = await reviewDecision(
    { state: "CHANGES_REQUESTED", user: { login: "reader" }, submitted_at: "2026-10-26T10:00:00.000Z" },
    permissions,
  );
  assert.equal(ignored?.recorded, false);
  assert.match(ignored?.note ?? "", /ignored/);

  const commentOnly = await reviewDecision(
    { state: "COMMENTED", user: { login: "maintainer" }, submitted_at: null },
    permissions,
  );
  assert.equal(commentOnly, null);
});

test("a close resolves the issue and never invents an actor", () => {
  const pullRequest: Pick<PullRequestPayload, "merged" | "merged_by" | "merged_at" | "html_url"> = {
    merged: false,
    merged_by: null,
    merged_at: null,
    html_url: "https://github.com/example/repo/pull/1",
  };
  const closed = closeOutcome(pullRequest, "2026-10-26T10:00:00.000Z");
  assert.equal(closed.issueState, "rejected");
  assert.equal(closed.decision.kind, "close");
  assert.equal(closed.decision.actor, "unknown");

  const merged = closeOutcome(
    { ...pullRequest, merged: true, merged_by: { login: "maintainer" }, merged_at: "2026-10-26T11:00:00.000Z" },
    "2026-10-26T11:00:05.000Z",
  );
  assert.equal(merged.issueState, "finished");
  assert.equal(merged.decision.actor, "maintainer");
});

test("opening a proposal sets the proposal label and never requests a merge", async () => {
  const created: string[] = [];
  const labeled: string[] = [];
  const result = await openProposal(
    {
      async createPullRequest(input) {
        created.push(input.title);
        return {
          number: 5,
          title: input.title,
          body: input.body,
          state: "open",
          merged: false,
          merged_at: null,
          merged_by: null,
          user: null,
          head: { ref: input.head, sha: "sha" },
          base: { ref: input.base },
          html_url: "https://github.com/example/repo/pull/5",
          draft: false,
          labels: [],
        };
      },
      async setPullRequestLabels(_number, labels) {
        labeled.push(...labels);
        return labels;
      },
    },
    {
      issueNumber: 12,
      issueUrl: "https://github.com/example/repo/issues/12",
      summary: "Fix it",
      changedPaths: ["a.txt"],
      notDone: [],
      verification: [],
      requestVersion: "v1",
      branch: "agent/12-fix-it",
      base: "main",
    },
    "agent:proposal",
  );
  assert.equal(result.pullRequest.draft, false);
  assert.equal(created.length, 1);
  assert.deepEqual(labeled, ["agent:proposal"]);
  assert.deepEqual(labelNames(result.pullRequest.labels), []);
});
