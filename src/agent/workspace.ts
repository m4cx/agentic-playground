import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { AgentError, errorMessage } from "./errors.js";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface WorkspaceLike {
  prepare(input: {
    owner: string;
    repo: string;
    token: string;
    defaultBranch: string;
    branch: string;
    resume: boolean;
  }): Promise<{
    headSha: string;
    behindBy: number;
    conflicts: string[];
    diffStat: string;
    recoveredBranch: boolean;
  }>;
  commitAll(subject: string, body: string): Promise<string | null>;
  commitEmpty(subject: string, body: string): Promise<string>;
  commitWip(subject: string, body: string): Promise<string | null>;
  push(branch: string): Promise<void>;
  headSha(): Promise<string>;
  diffStat(): Promise<string>;
  changedPaths(): Promise<string[]>;
}

export class GitWorkspace implements WorkspaceLike {
  readonly root: string;
  private token = "";

  constructor(root: string) {
    this.root = root;
  }

  async run(args: string[], allowFailure = false): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn("git", args, {
        cwd: this.root,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_CONFIG_NOSYSTEM: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        reject(new AgentError("workspace", `cannot run git: ${errorMessage(error)}`));
      });
      child.on("close", (code) => {
        const safeStderr = this.redact(stderr);
        if (code !== 0 && !allowFailure) {
          reject(
            new AgentError(
              "workspace",
              `git ${args.join(" ")} failed with ${code}: ${safeStderr.slice(0, 1000)}`,
            ),
          );
          return;
        }
        resolve({ code: code ?? 1, stdout, stderr: safeStderr });
      });
    });
  }

  private redact(value: string): string {
    return this.token.length > 0 ? value.split(this.token).join("[redacted]") : value;
  }

  async prepare(input: {
    owner: string;
    repo: string;
    token: string;
    defaultBranch: string;
    branch: string;
    resume: boolean;
  }): Promise<{
    headSha: string;
    behindBy: number;
    conflicts: string[];
    diffStat: string;
    recoveredBranch: boolean;
  }> {
    this.token = input.token;
    mkdirSync(path.dirname(this.root), { recursive: true });

    if (!(await this.isRepository())) {
      await this.run([
        "clone",
        "--no-checkout",
        `https://x-access-token:${input.token}@github.com/${input.owner}/${input.repo}.git`,
        this.root,
      ]);
    }

    await this.run(["fetch", "--prune", "origin"]);
    const exists = input.resume && (await this.remoteBranchExists(input.branch));
    const recoveredBranch = input.resume && !exists;
    await this.run([
      "checkout",
      "-B",
      input.branch,
      exists ? `origin/${input.branch}` : `origin/${input.defaultBranch}`,
    ]);

    let headSha = await this.headSha();
    let behindBy = 0;
    const conflicts: string[] = [];

    if (exists) {
      const count = await this.run([
        "rev-list",
        "--count",
        `HEAD..origin/${input.defaultBranch}`,
      ]);
      behindBy = Number(count.stdout.trim()) || 0;
      if (behindBy > 0) {
        const merge = await this.run(["merge", "--no-edit", `origin/${input.defaultBranch}`], true);
        if (merge.code !== 0) {
          conflicts.push(...(await this.getConflictedPaths()));
        }
        headSha = await this.headSha();
      }
    }

    return {
      headSha,
      behindBy,
      conflicts,
      diffStat: await this.diffStatAgainst(input.defaultBranch),
      recoveredBranch,
    };
  }

  private async isRepository(): Promise<boolean> {
    const result = await this.run(["rev-parse", "--git-dir"], true);
    return result.code === 0;
  }

  private async remoteBranchExists(branch: string): Promise<boolean> {
    const result = await this.run(
      ["ls-remote", "--exit-code", "--heads", "origin", branch],
      true,
    );
    return result.code === 0 && result.stdout.trim().length > 0;
  }

  async getConflictedPaths(): Promise<string[]> {
    const result = await this.run(["diff", "--name-only", "--diff-filter=U"]);
    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  async statusPorcelain(): Promise<string> {
    const result = await this.run(["status", "--porcelain"]);
    return result.stdout;
  }

  async diffStatAgainst(defaultBranch: string): Promise<string> {
    const result = await this.run(["diff", "--stat", `origin/${defaultBranch}...HEAD`]);
    return result.stdout.trim();
  }

  async diffStat(): Promise<string> {
    const result = await this.run(["diff", "--stat", "HEAD~1..HEAD"], true);
    return result.stdout.trim();
  }

  async changedPaths(): Promise<string[]> {
    const result = await this.run(["show", "--pretty=format:", "--name-only", "HEAD"], true);
    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  async headSha(): Promise<string> {
    const result = await this.run(["rev-parse", "HEAD"]);
    return result.stdout.trim();
  }

  private async commit(subject: string, body: string, allowEmpty: boolean): Promise<string | null> {
    const status = await this.statusPorcelain();
    if (status.trim().length === 0 && !allowEmpty) {
      return null;
    }
    if (status.trim().length > 0) {
      await this.run(["add", "--all"]);
    }
    const args = [
      "-c",
      "user.name=agentic-playground",
      "-c",
      "user.email=agent@users.noreply.github.com",
      "commit",
      "-m",
      subject,
      "-m",
      body,
    ];
    if (allowEmpty) {
      args.push("--allow-empty");
    }
    await this.run(args);
    return this.headSha();
  }

  async commitAll(subject: string, body: string): Promise<string | null> {
    return this.commit(subject, body, false);
  }

  async commitEmpty(subject: string, body: string): Promise<string> {
    const sha = await this.commit(subject, body, true);
    if (!sha) {
      throw new AgentError("workspace", "empty commit did not produce a commit");
    }
    return sha;
  }

  async commitWip(subject: string, body: string): Promise<string | null> {
    return this.commit(subject, body, false);
  }

  async push(branch: string): Promise<void> {
    const result = await this.run(["push", "origin", `HEAD:refs/heads/${branch}`], true);
    if (result.code !== 0) {
      throw new AgentError("push", `push of ${branch} failed: ${result.stderr.slice(0, 1000)}`);
    }
  }
}
