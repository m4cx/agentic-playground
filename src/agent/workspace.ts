/**
 * Workspace ownership: branch creation, diff collection, commit, and the one
 * credential-bearing push (contracts/proposal.md, FR-007, FR-018, FR-021).
 *
 * The agent never commits or pushes. The orchestrator does, on the agent's behalf,
 * and only to a branch that is not the default branch.
 */

import { execFile, spawnSync } from "node:child_process";
import {
  chmodSync,
  chownSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { ProposalConfig } from "./config.js";
import type { PiRuntime } from "./pi-runtime.js";
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

export interface EgressProbeResult {
  workTreeWritable: boolean;
  gitDirReadable: boolean;
  gitDirWritable: boolean;
  dotGitPresent: boolean;
  nodeModulesWritable: boolean;
  entryReadable: boolean;
  nodeExecutable: boolean;
  sessionWritable: boolean;
}

/**
 * The workspace boundary must fail closed: exactly these outcomes are accepted.
 * Kept pure so the rule is testable without root (task T109).
 */
export function verifyEgressBoundaries(result: EgressProbeResult): void {
  if (!result.workTreeWritable) {
    throw new WorkspaceError("the egress uid cannot write the work tree", "environment");
  }
  if (result.gitDirReadable || result.gitDirWritable) {
    throw new WorkspaceError("the egress uid can reach GIT_DIR; the git directory must stay outside the work tree", "environment");
  }
  if (result.dotGitPresent) {
    throw new WorkspaceError("the work tree still contains a .git entry; the agent could replace it", "environment");
  }
  if (result.nodeModulesWritable) {
    throw new WorkspaceError("the egress uid can write node_modules; the agent could rewrite its harness", "environment");
  }
  if (!result.entryReadable) {
    throw new WorkspaceError("the egress uid cannot read the resolved Pi entry", "environment");
  }
  if (!result.nodeExecutable) {
    throw new WorkspaceError("the egress uid cannot execute the Node binary", "environment");
  }
  if (!result.sessionWritable) {
    throw new WorkspaceError("the egress uid cannot write the session cache directory", "environment");
  }
}

export interface PrepareWorkspaceOptions {
  repoRoot: string;
  runTemp: string;
  sessionDir: string;
  egressUid: number;
  egressGid?: number;
  /** The resolved runtime whose entry/node must be readable/executable by the egress uid. */
  runtime?: PiRuntime;
  /** The job user that must be able to read the session cache after the run. */
  cacheOwnerUid?: number;
  cacheOwnerGid?: number;
  /** Test seam: replaces the default probe spawned as the egress uid. */
  probe?: (input: PrepareWorkspaceOptions) => EgressProbeResult;
  /** Test seam: replaces the real chown. */
  chown?: (path: string, uid: number, gid: number) => void;
  /** Test seam: the Node binary used for the default probe. */
  probeNode?: string;
}

export interface PreparedWorkspace {
  gitDir: string;
  /** Owner of the session cache before it was handed to the egress uid. */
  sessionOwnerUid: number;
  sessionOwnerGid: number;
}

function chownTree(
  root: string,
  uid: number,
  gid: number,
  chown: (path: string, uid: number, gid: number) => void,
): void {
  const nodeModules = join(root, "node_modules");
  const walk = (directory: string): void => {
    const stats = lstatSync(directory);
    if (stats.isSymbolicLink()) return;
    chown(directory, uid, gid);
    if (!stats.isDirectory()) return;
    for (const entry of readdirSync(directory)) {
      const absolute = join(directory, entry);
      if (absolute === nodeModules) continue;
      walk(absolute);
    }
  };
  walk(root);
}

/** Make every ancestor of `root` traversable for the egress uid, without listing rights. */
function ensureAncestorTraversal(root: string): void {
  let directory = resolve(root);
  for (;;) {
    try {
      const mode = statSync(directory).mode;
      if ((mode & 0o001) === 0) chmodSync(directory, mode | 0o001);
    } catch {
      // Ancestors outside our control (for example a platform temp dir) may refuse
      // chmod; the egress probe below is the authority and fails closed.
    }
    const parent = dirname(directory);
    if (parent === directory) return;
    directory = parent;
  }
}

function defaultEgressProbe(options: PrepareWorkspaceOptions): EgressProbeResult {
  if (options.runtime === undefined) {
    throw new WorkspaceError("the egress probe needs the resolved Pi runtime", "environment");
  }
  const script = `
const fs = require("node:fs");
const path = require("node:path");
const out = {
  workTreeWritable: false,
  gitDirReadable: false,
  gitDirWritable: false,
  dotGitPresent: false,
  nodeModulesWritable: false,
  entryReadable: false,
  nodeExecutable: false,
  sessionWritable: false,
};
const work = ${JSON.stringify(options.repoRoot)};
const gitDir = ${JSON.stringify(join(options.runTemp, "agent-git"))};
const nodeModules = path.join(work, "node_modules");
try {
  const probe = path.join(work, ".agent-write-probe");
  fs.writeFileSync(probe, "ok");
  fs.unlinkSync(probe);
  out.workTreeWritable = true;
} catch {}
try { fs.readdirSync(gitDir); out.gitDirReadable = true; } catch {}
try {
  const probe = path.join(gitDir, ".agent-write-probe");
  fs.writeFileSync(probe, "ok");
  fs.unlinkSync(probe);
  out.gitDirWritable = true;
} catch {}
out.dotGitPresent = fs.existsSync(path.join(work, ".git"));
try {
  fs.accessSync(${JSON.stringify(options.runtime.entry)}, fs.constants.R_OK);
  out.entryReadable = true;
} catch {}
try {
  fs.accessSync(${JSON.stringify(options.runtime.nodePath)}, fs.constants.X_OK);
  out.nodeExecutable = true;
} catch {}
try {
  const probe = path.join(${JSON.stringify(options.sessionDir)}, ".agent-write-probe");
  fs.writeFileSync(probe, "ok");
  fs.unlinkSync(probe);
  out.sessionWritable = true;
} catch {}
try {
  const probe = path.join(nodeModules, ".agent-write-probe");
  fs.writeFileSync(probe, "ok");
  fs.unlinkSync(probe);
  out.nodeModulesWritable = true;
} catch {}
process.stdout.write(JSON.stringify(out));
`;
  const result = spawnSync(options.probeNode ?? process.execPath, ["-e", script], {
    uid: options.egressUid,
    gid: options.egressGid ?? options.egressUid,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: join(options.sessionDir, "home"),
      TMPDIR: join(options.sessionDir, "tmp"),
    },
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new WorkspaceError(
      `the egress probe failed: ${result.error?.message ?? result.stderr ?? `exit ${String(result.status)}`}`,
      "environment",
    );
  }
  try {
    return JSON.parse(result.stdout) as EgressProbeResult;
  } catch {
    throw new WorkspaceError("the egress probe returned an unparsable result", "environment");
  }
}

/**
 * Move the checkout's git directory outside the work tree, hand the work tree to
 * the egress uid (except node_modules), make the path traversable, and probe the
 * boundary. A failure is `environment`, before the acknowledgement.
 */
function prepareAgentWorkspaceUnsafe(options: PrepareWorkspaceOptions): PreparedWorkspace {
  const gitDir = join(options.runTemp, "agent-git");
  const dotGit = join(options.repoRoot, ".git");
  mkdirSync(options.runTemp, { recursive: true });
  if (existsSync(dotGit)) {
    rmSync(gitDir, { recursive: true, force: true });
    renameSync(dotGit, gitDir);
  } else if (!existsSync(gitDir)) {
    throw new WorkspaceError("the checkout has no git directory to isolate", "environment");
  }
  if (existsSync(dotGit)) rmSync(dotGit, { recursive: true, force: true });
  const chown = options.chown ?? chownSync;
  if (process.getuid?.() === 0) chownTree(gitDir, 0, 0, chown);
  chmodSync(gitDir, 0o700);

  mkdirSync(options.sessionDir, { recursive: true });
  const sessionStats = lstatSync(options.sessionDir);
  if (sessionStats.isSymbolicLink() || !sessionStats.isDirectory()) {
    throw new WorkspaceError("the session cache path is not a real directory", "environment");
  }
  const sessionOwnerUid = options.cacheOwnerUid ?? sessionStats.uid;
  const sessionOwnerGid = options.cacheOwnerGid ?? sessionStats.gid;
  chownTree(options.repoRoot, options.egressUid, options.egressGid ?? options.egressUid, chown);
  // The restored cache is extracted as the runner; Pi runs as the egress uid and
  // must be able to append to an existing session file.
  chownTree(options.sessionDir, options.egressUid, options.egressGid ?? options.egressUid, chown);
  ensureAncestorTraversal(options.repoRoot);
  ensureAncestorTraversal(options.sessionDir);

  const probe = options.probe ?? defaultEgressProbe;
  verifyEgressBoundaries(probe(options));
  return { gitDir, sessionOwnerUid, sessionOwnerGid };
}

/** Hand the session cache back to the runner so the cache-save step can read it. */
export function restoreSessionOwnership(
  sessionDir: string,
  uid: number,
  gid: number,
  chown: (path: string, uid: number, gid: number) => void = chownSync,
): void {
  try {
    chownTree(sessionDir, uid, gid, chown);
  } catch {
    // Best effort: a missing cache is not an error, and the run itself has ended.
  }
}

export function prepareAgentWorkspace(options: PrepareWorkspaceOptions): PreparedWorkspace {
  try {
    return prepareAgentWorkspaceUnsafe(options);
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    throw new WorkspaceError(
      `could not prepare the agent workspace: ${error instanceof Error ? error.message : String(error)}`,
      "environment",
    );
  }
}

export interface WorkspaceOptions {
  repoRoot: string;
  defaultBranch: string;
  issueNumber: number;
  proposal: ProposalConfig;
  secrets: readonly string[];
  /** Root-owned git directory outside the work tree; omitted in unit tests. */
  gitDir?: string;
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
  private readonly gitDir: string | undefined;
  private branch: string | null = null;

  constructor(options: WorkspaceOptions) {
    this.options = options;
    this.runGit = options.runGit ?? defaultGitRunner(options.repoRoot);
    this.gitDir = options.gitDir;
  }

  /** Prefix the separate git directory and the hardened git options. */
  private gitArgs(args: readonly string[]): string[] {
    if (this.gitDir === undefined) return [...args];
    return [
      "--git-dir",
      this.gitDir,
      "--work-tree",
      this.options.repoRoot,
      "-c",
      `safe.directory=${this.options.repoRoot}`,
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ];
  }

  private git(args: readonly string[], env?: NodeJS.ProcessEnv): Promise<GitResult> {
    return this.runGit(this.gitArgs(args), env === undefined ? {} : { env });
  }

  get currentBranch(): string | null {
    return this.branch;
  }

  /** Create the branch from the current default-branch head. */
  async createBranch(title: string): Promise<string> {
    const existing = await this.remoteBranches("agent/");
    const branch = branchName(this.options.issueNumber, title, existing);
    const created = await this.git(["switch", "-c", branch]);
    if (created.code !== 0) {
      throw new WorkspaceError(`could not create branch ${branch}`, "environment");
    }
    this.branch = branch;
    return branch;
  }

  private async remoteBranches(prefix: string): Promise<string[]> {
    const result = await this.git(["branch", "--all", "--format=%(refname:short)"]);
    if (result.code !== 0) return [];
    return result.stdout
      .split("\n")
      .map((line) => line.trim().replace(/^origin\//, ""))
      .filter((line) => line.startsWith(prefix));
  }

  /** Stage everything the agent produced, excluding build output and sessions. */
  async stageChanges(): Promise<DiffCheck> {
    const add = await this.git(["add", "--all", "--", "."]);
    if (add.code !== 0) throw new WorkspaceError("could not stage changes", "environment");
    const numstat = await this.git(["diff", "--cached", "--numstat"]);
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
    const result = await this.git(["commit", "--no-verify", "-m", message]);
    if (result.code !== 0) throw new WorkspaceError("could not commit the change", "environment");
  }

  async hasStagedChanges(): Promise<boolean> {
    const result = await this.git(["diff", "--cached", "--quiet"]);
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
    const result = await this.git(["push", "origin", `${this.branch}:${this.branch}`], {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.extraheader",
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
    });
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
    const configPath = this.gitDir === undefined ? join(this.options.repoRoot, ".git", "config") : join(this.gitDir, "config");
    if (!existsSync(configPath)) return;
    const content = readFileSync(configPath, "utf8");
    if (/extraheader/i.test(content) || containsCredential(content)) {
      throw new WorkspaceError("the workspace git config contains a credential", "environment");
    }
  }
}
