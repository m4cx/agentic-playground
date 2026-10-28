import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { GitWorkspace } from "../../src/agent/workspace.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

test("prepare creates a missing workspace directory before cloning", async () => {
  const base = mkdtempSync(path.join(tmpdir(), "agentic-workspace-"));
  try {
    const bare = path.join(base, "origin.git");
    execFileSync("git", ["init", "--bare", bare], { encoding: "utf8" });
    const seed = path.join(base, "seed");
    execFileSync("git", ["clone", bare, seed], { encoding: "utf8" });
    git(seed, "config", "user.name", "Test");
    git(seed, "config", "user.email", "test@example.com");
    writeFileSync(path.join(seed, "README.md"), "hello\n");
    git(seed, "add", ".");
    git(seed, "commit", "-m", "initial");
    git(seed, "push", "origin", "HEAD:main");

    const root = path.join(base, "work", "issue-1");
    const workspace = new GitWorkspace(root);
    const result = await workspace.prepare({
      owner: "owner",
      repo: "repo",
      token: "supersecret",
      defaultBranch: "main",
      branch: "feature/1-test",
      resume: false,
      remoteUrl: bare,
    });

    assert.equal(result.recoveredBranch, false);
    assert.equal(await workspace.headSha(), result.headSha);
    assert.equal(git(root, "rev-parse", "--abbrev-ref", "HEAD"), "feature/1-test");
    assert.equal(
      execFileSync("git", ["config", "--get", "remote.origin.url"], { cwd: root, encoding: "utf8" }).includes("supersecret"),
      false,
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("clone failure does not leak the token in the error message", async () => {
  const base = mkdtempSync(path.join(tmpdir(), "agentic-workspace-redact-"));
  try {
    const workspace = new GitWorkspace(path.join(base, "bad"));
    await assert.rejects(
      () =>
        workspace.prepare({
          owner: "owner",
          repo: "repo",
          token: "supersecret",
          defaultBranch: "main",
          branch: "feature/1-test",
          resume: false,
          remoteUrl: "https://x-access-token:supersecret@127.0.0.1:1/repo.git",
        }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.equal(message.includes("supersecret"), false);
        return true;
      },
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("resume merges the default branch with a configured identity", async () => {
  const base = mkdtempSync(path.join(tmpdir(), "agentic-workspace-merge-"));
  try {
    const bare = path.join(base, "origin.git");
    execFileSync("git", ["init", "--bare", bare], { encoding: "utf8" });
    const seed = path.join(base, "seed");
    execFileSync("git", ["clone", bare, seed], { encoding: "utf8" });
    git(seed, "config", "user.name", "Test");
    git(seed, "config", "user.email", "test@example.com");
    writeFileSync(path.join(seed, "README.md"), "hello\n");
    git(seed, "add", ".");
    git(seed, "commit", "-m", "initial");
    git(seed, "push", "origin", "HEAD:main");

    const root = path.join(base, "work", "issue-2");
    const workspace = new GitWorkspace(root);
    await workspace.prepare({
      owner: "owner",
      repo: "repo",
      token: "token",
      defaultBranch: "main",
      branch: "feature/2-test",
      resume: false,
      remoteUrl: bare,
    });

    git(root, "push", "origin", "HEAD:refs/heads/feature/2-test");

    writeFileSync(path.join(seed, "CHANGELOG.md"), "new\n");
    git(seed, "add", ".");
    git(seed, "commit", "-m", "advance main");
    git(seed, "push", "origin", "HEAD:main");

    const result = await workspace.prepare({
      owner: "owner",
      repo: "repo",
      token: "token",
      defaultBranch: "main",
      branch: "feature/2-test",
      resume: true,
      remoteUrl: bare,
    });
    assert.equal(result.behindBy, 1);
    assert.deepEqual(result.conflicts, []);
    assert.equal(git(root, "rev-parse", "--abbrev-ref", "HEAD"), "feature/2-test");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
