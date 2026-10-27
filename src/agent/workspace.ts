/**
 * Workspace ownership: branch creation, diff collection, commit, and the one
 * credential-bearing push (contracts/proposal.md, FR-007, FR-018, FR-021).
 *
 * The agent never commits or pushes. The orchestrator does, on the agent's behalf,
 * and only to a branch that is not the default branch.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { ProposalConfig } from "./config.js";
import { containsCredential, redact } from "./redact.js";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type GitRunner = (args: string[], options?: { env?: NodeJS.ProcessEnv }) => Promise<GitResult>;

export class WorkspaceError extends Error {
  readonly reason: "content-conflict" | "environment" | "secret-request" | "request-too-large";
  readonly paths: string[];

  constructor(message: string, reason: WorkspaceError["reason"], paths: string[] = []) {
    super(message);
    this.name = "WorkspaceError";
    this.reason = reason;
    this.paths = paths;
  }
}

export const MAX_SLUG_WORDS = 6;

/**
 * Derive a lower-case ASCII slug. Non-Latin titles fall back to
 * `issue-<number>`: no transliterated foreign words leak into repository
 * identifiers as prose (constitution I).
 */
export function slugify(title: string, issueNumber: number): string {
  const words = title
    .toLowerCase()
    // Fixed Latin transliteration, so no foreign word is ever guessed at.
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, MAX_SLUG_WORDS);
  if (words.length === 0) return `issue-${issueNumber}`;
  const slug = words.join("-").slice(0, 48).replace(/-+$/, "");
  return slug.length === 0 ? `issue-${issueNumber}` : slug;
}

/** `agent/<issue>-<slug>`, with `-2`, `-3`, … instead of a force-push. */
export function branchName(issueNumber: number, title: string, existingBranches: readonly string[] = []): string {
  const base = `agent/${issueNumber}-${slugify(title, issueNumber)}`;
  if (!existingBranches.includes(base)) return base;
  let suffix = 2;
  while (existingBranches.includes(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

/** One English commit message per run, at most 72 characters. */
export function commitMessage(summary: string | null | undefined, issueNumber: number): string {
  const cleaned = (summary ?? "")
    .replace(/\s+/g, " ")
    .replace(/[`*_#>]/g, "")
    .trim();
  const fallback = `address issue ${issueNumber}`;
  const candidate = cleaned.length === 0 ? fallback : cleaned;
  const message = `agent: ${candidate} (#${issueNumber})`;
  if (message.length <= 72) return message;
  const room = 72 - `agent:  (#${issueNumber})`.length;
  const shortened = candidate.slice(0, Math.max(1, room)).trimEnd();
  return `agent: ${shortened} (#${issueNumber})`;
}

export interface DiffBounds {
  changedPaths: string[];
  addedLines: number;
  removedLines: number;
}

export interface DiffCheck extends DiffBounds {
  tooLarge: boolean;
  cause: "changed-paths" | "diff-lines" | null;
}

/** Parse `git diff --numstat` output and apply the configured bounds. */
export function checkDiffBounds(numstat: string, proposal: ProposalConfig): DiffCheck {
  const changedPaths: string[] = [];
  let addedLines = 0;
  let removedLines = 0;
  for (const line of numstat.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const parts = trimmed.split("\t");
    if (parts.length < 3) continue;
    const added = parts[0] === "-" ? 0 : Number.parseInt(parts[0] ?? "0", 10);
    const removed = parts[1] === "-" ? 0 : Number.parseInt(parts[1] ?? "0", 10);
    const path = parts[2] ?? "";
    if (path.length === 0) continue;
    changedPaths.push(path);
    addedLines += Number.isFinite(added) ? added : 0;
    removedLines += Number.isFinite(removed) ? removed : 0;
  }
  const tooManyPaths = changedPaths.length > proposal.maxChangedPaths;
  const tooManyLines = addedLines + removedLines > proposal.maxDiffLines;
  return {
    changedPaths,
    addedLines,
    removedLines,
    tooLarge: tooManyPaths || tooManyLines,
    cause: tooManyPaths ? "changed-paths" : tooManyLines ? "diff-lines" : null,
  };
}

/** Files that are never part of a proposal: build output, sessions, and git metadata. */
export function isExcludedPath(path: string): boolean {
  const normalised = path.replaceAll("\\", "/");
  if (normalised.startsWith(".git/") || normalised === ".git") return true;
  if (normalised === "dist" || normalised.startsWith("dist/")) return true;
  if (normalised.includes("pi-sessions/")) return true;
  if (normalised.endsWith(".session.jsonl")) return true;
  if (normalised === "node_modules" || normalised.startsWith("node_modules/")) return true;
  return false;
}

export interface ScannedFile {
  path: string;
  content: string;
}

export interface SecretScan {
  detected: boolean;
  paths: string[];
  redactedPaths: string[];
}

/** Redact before commit; a credential that survives is an abort, not a rewrite. */
export function scanForCredentials(files: readonly ScannedFile[], secrets: readonly string[]): SecretScan {
  const paths: string[] = [];
  const redactedPaths: string[] = [];
  for (const file of files) {
    const result = redact(file.content, secrets);
    if (result.redacted) redactedPaths.push(file.path);
    // A credential in the content aborts the proposal; redaction alone is not enough
    // for a file that would otherwise be committed with the secret's origin.
    if (containsCredential(file.content, secrets)) paths.push(file.path);
  }
  return { detected: paths.length > 0, paths, redactedPaths };
}

export interface WorkspaceOptions {
  repoRoot: string;
  defaultBranch: string;
  issueNumber: number;
  proposal: ProposalConfig;
  secrets: readonly string[];
  runGit?: GitRunner;
}

function defaultGitRunner(repoRoot: string): GitRunner {
  return (args, options = {}) =>
    new Promise<GitResult>((resolve) => {
      execFile(
        "git",
        args,
        {
          cwd: repoRoot,
          env: { ...process.env, ...options.env, GIT_TERMINAL_PROMPT: "0" },
          maxBuffer: 32 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
          resolve({ code, stdout: stdout ?? "", stderr: stderr ?? "" });
        },
      );
    });
}

export class Workspace {
  private readonly options: WorkspaceOptions;
  private readonly runGit: GitRunner;
  private branch: string | null = null;

  constructor(options: WorkspaceOptions) {
    this.options = options;
    this.runGit = options.runGit ?? defaultGitRunner(options.repoRoot);
  }

  get currentBranch(): string | null {
    return this.branch;
  }

  /** Create the branch from the current default-branch head. */
  async createBranch(title: string): Promise<string> {
    const existing = await this.remoteBranches("agent/");
    const branch = branchName(this.options.issueNumber, title, existing);
    const created = await this.runGit(["switch", "-c", branch]);
    if (created.code !== 0) {
      throw new WorkspaceError(`could not create branch ${branch}`, "environment");
    }
    this.branch = branch;
    return branch;
  }

  private async remoteBranches(prefix: string): Promise<string[]> {
    const result = await this.runGit(["branch", "--all", "--format=%(refname:short)"]);
    if (result.code !== 0) return [];
    return result.stdout
      .split("\n")
      .map((line) => line.trim().replace(/^origin\//, ""))
      .filter((line) => line.startsWith(prefix));
  }

  /** Stage everything the agent produced, excluding build output and sessions. */
  async stageChanges(): Promise<DiffCheck> {
    const add = await this.runGit(["add", "--all", "--", "."]);
    if (add.code !== 0) throw new WorkspaceError("could not stage changes", "environment");
    const numstat = await this.runGit(["diff", "--cached", "--numstat"]);
    if (numstat.code !== 0) throw new WorkspaceError("could not read the diff", "environment");
    const filtered = numstat.stdout
      .split("\n")
      .filter((line) => {
        const path = line.split("\t")[2];
        return path !== undefined && !isExcludedPath(path);
      })
      .join("\n");
    const bounds = checkDiffBounds(filtered, this.options.proposal);
    return bounds;
  }

  /** Scan the staged files, redacting first and aborting only if a credential survives. */
  scanStagedChanges(): SecretScan {
    const files = this.listWorkspaceFiles();
    return scanForCredentials(files, this.options.secrets);
  }

  private listWorkspaceFiles(): ScannedFile[] {
    const root = this.options.repoRoot;
    const files: ScannedFile[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory)) {
        const absolute = join(directory, entry);
        const relativePath = relative(root, absolute).replaceAll("\\", "/");
        if (isExcludedPath(relativePath)) continue;
        const stats = statSync(absolute);
        if (stats.isDirectory()) {
          walk(absolute);
          continue;
        }
        if (!stats.isFile() || stats.size > 512 * 1024) continue;
        try {
          files.push({ path: relativePath, content: readFileSync(absolute, "utf8") });
        } catch {
          // Binary or unreadable file: not a text artifact, nothing to scan.
        }
      }
    };
    walk(root);
    return files;
  }

  async commit(message: string): Promise<void> {
    const result = await this.runGit(["commit", "-m", message]);
    if (result.code !== 0) throw new WorkspaceError("could not commit the change", "environment");
  }

  async hasStagedChanges(): Promise<boolean> {
    const result = await this.runGit(["diff", "--cached", "--quiet"]);
    return result.code !== 0;
  }

  /**
   * Push with a per-command credential. The token is passed as a command argument
   * only, never written to `.git/config`, and the environment stays clean.
   */
  async pushWithCredential(token: string): Promise<void> {
    if (this.branch === null) throw new WorkspaceError("no branch to push", "environment");
    if (token.trim().length === 0) {
      throw new WorkspaceError("no usable credential was provided for the push", "environment");
    }
    const basic = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
    const result = await this.runGit([
      "-c",
      `http.extraheader=AUTHORIZATION: basic ${basic}`,
      "push",
      "origin",
      `${this.branch}:${this.branch}`,
    ]);
    if (result.code !== 0) {
      const conflict = /non-fast-forward|rejected|protected branch|pre-receive hook/i.test(result.stderr);
      throw new WorkspaceError(
        conflict ? "the push was rejected by the remote" : "the push failed",
        conflict ? "content-conflict" : "environment",
      );
    }
    await this.assertNoCredentialInGitConfig();
  }

  /** The workspace git config must never contain a credential after the push. */
  async assertNoCredentialInGitConfig(): Promise<void> {
    const configPath = join(this.options.repoRoot, ".git", "config");
    if (!existsSync(configPath)) return;
    const content = readFileSync(configPath, "utf8");
    if (/extraheader/i.test(content) || containsCredential(content)) {
      throw new WorkspaceError("the workspace git config contains a credential", "environment");
    }
  }
}
