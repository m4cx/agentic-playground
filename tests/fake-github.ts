/**
 * In-memory GitHub surface and fake workspace for integration tests.
 *
 * The fake implements exactly the client methods the orchestrator uses, so a test
 * exercises the real orchestration code against a deterministic record — no
 * network, no repository, and no Pi binary.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { loadConfig, type AgentConfig, type LoadedConfig } from "../src/agent/config.js";
import { labelNames, type CreatePullRequestInput, type IssueCommentPayload, type IssuePayload, type PullRequestPayload, type ReviewPayload } from "../src/agent/github.js";
import { Orchestrator, type OrchestratorClient, type OrchestratorOptions } from "../src/agent/main.js";
import { Workspace, WorkspaceError } from "../src/agent/workspace.js";

export interface FakeIssueInput {
  number: number;
  title: string;
  body?: string | null;
  labels?: string[];
  state?: "open" | "closed";
  updatedAt?: string;
}

export class FakeGitHub implements OrchestratorClient {
  readonly issues = new Map<number, IssuePayload>();
  readonly comments = new Map<number, IssueCommentPayload[]>();
  readonly pullRequests = new Map<number, PullRequestPayload>();
  readonly permissions = new Map<string, string>();
  readonly createdComments: IssueCommentPayload[] = [];
  readonly pullRequestInputs: CreatePullRequestInput[] = [];

  onGetIssue: ((issue: IssuePayload, callCount: number) => void) | null = null;
  getIssueCalls = 0;
  private nextCommentId = 1000;
  private nextPullNumber = 500;

  addIssue(input: FakeIssueInput): IssuePayload {
    const at = input.updatedAt ?? new Date().toISOString();
    const issue: IssuePayload = {
      number: input.number,
      title: input.title,
      body: input.body ?? "",
      state: input.state ?? "open",
      labels: (input.labels ?? []).map((name) => ({ name })),
      user: { login: "requester" },
      created_at: at,
      updated_at: at,
      closed_at: null,
      html_url: `https://github.com/example/repo/issues/${input.number}`,
    };
    this.issues.set(issue.number, issue);
    this.comments.set(issue.number, []);
    return issue;
  }

  updateIssue(issueNumber: number, patch: Partial<IssuePayload>): void {
    const issue = this.issues.get(issueNumber);
    if (issue === undefined) throw new Error(`unknown issue ${issueNumber}`);
    this.issues.set(issueNumber, { ...issue, ...patch });
  }

  addComment(issueNumber: number, input: { login: string; body: string; at?: string; id?: number }): IssueCommentPayload {
    const list = this.comments.get(issueNumber);
    if (list === undefined) throw new Error(`unknown issue ${issueNumber}`);
    const at = input.at ?? new Date().toISOString();
    const comment: IssueCommentPayload = {
      id: input.id ?? this.nextCommentId++,
      body: input.body,
      user: { login: input.login },
      created_at: at,
      updated_at: at,
      html_url: `https://github.com/example/repo/issues/${issueNumber}#issuecomment-${input.id ?? 0}`,
    };
    list.push(comment);
    return comment;
  }

  setPermission(login: string, permission: string): void {
    this.permissions.set(login, permission);
  }

  commentsFor(issueNumber: number): readonly IssueCommentPayload[] {
    return this.comments.get(issueNumber) ?? [];
  }

  bodiesContaining(issueNumber: number, text: string): IssueCommentPayload[] {
    return this.commentsFor(issueNumber).filter((comment) => (comment.body ?? "").includes(text));
  }

  markerComments(issueNumber: number, kind: string): IssueCommentPayload[] {
    return this.commentsFor(issueNumber).filter((comment) =>
      (comment.body ?? "").startsWith(`<!-- agent:${kind}`),
    );
  }

  labelsOf(issueNumber: number): string[] {
    return labelNames(this.issues.get(issueNumber)?.labels ?? []);
  }

  async getIssue(issueNumber: number): Promise<IssuePayload> {
    const issue = this.issues.get(issueNumber);
    if (issue === undefined) throw new Error(`unknown issue ${issueNumber}`);
    this.getIssueCalls += 1;
    this.onGetIssue?.(issue, this.getIssueCalls);
    return this.issues.get(issueNumber) ?? issue;
  }

  async listIssueComments(issueNumber: number): Promise<IssueCommentPayload[]> {
    return [...(this.comments.get(issueNumber) ?? [])];
  }

  async createIssueComment(issueNumber: number, body: string): Promise<IssueCommentPayload> {
    const comment = this.addComment(issueNumber, { login: "agent", body });
    this.createdComments.push(comment);
    return comment;
  }

  async updateIssueComment(commentId: number, body: string): Promise<IssueCommentPayload> {
    for (const list of this.comments.values()) {
      const index = list.findIndex((comment) => comment.id === commentId);
      if (index >= 0) {
        const existing = list[index];
        if (existing === undefined) break;
        const updated: IssueCommentPayload = { ...existing, body, updated_at: new Date().toISOString() };
        list[index] = updated;
        return updated;
      }
    }
    throw new Error(`unknown comment ${commentId}`);
  }

  async addLabels(issueNumber: number, labels: string[]): Promise<unknown> {
    const issue = this.issues.get(issueNumber);
    if (issue === undefined) throw new Error(`unknown issue ${issueNumber}`);
    const present = labelNames(issue.labels);
    const merged = [...present, ...labels.filter((label) => !present.includes(label))];
    this.issues.set(issueNumber, { ...issue, labels: merged.map((name) => ({ name })) });
    return merged;
  }

  async removeLabel(issueNumber: number, label: string): Promise<void> {
    const issue = this.issues.get(issueNumber);
    if (issue === undefined) throw new Error(`unknown issue ${issueNumber}`);
    const remaining = labelNames(issue.labels).filter((name) => name !== label);
    this.issues.set(issueNumber, { ...issue, labels: remaining.map((name) => ({ name })) });
  }

  async getCollaboratorPermission(login: string): Promise<{ permission: string }> {
    const permission = this.permissions.get(login);
    if (permission === undefined) return { permission: "none" };
    return { permission };
  }

  async createPullRequest(input: CreatePullRequestInput): Promise<PullRequestPayload> {
    const number = this.nextPullNumber++;
    this.pullRequestInputs.push(input);
    const pullRequest: PullRequestPayload = {
      number,
      title: input.title,
      body: input.body,
      state: "open",
      merged: false,
      merged_at: null,
      merged_by: null,
      user: { login: "agent" },
      head: { ref: input.head, sha: "head-sha" },
      base: { ref: input.base },
      html_url: `https://github.com/example/repo/pull/${number}`,
      draft: input.draft ?? false,
      labels: (input.labels ?? []).map((name) => ({ name })),
    };
    this.pullRequests.set(number, pullRequest);
    return pullRequest;
  }

  async setPullRequestLabels(pullNumber: number, labels: string[]): Promise<unknown> {
    const pullRequest = this.pullRequests.get(pullNumber);
    if (pullRequest === undefined) throw new Error(`unknown pull request ${pullNumber}`);
    const present = labelNames(pullRequest.labels);
    const merged = [...present, ...labels.filter((label) => !present.includes(label))];
    this.pullRequests.set(pullNumber, { ...pullRequest, labels: merged.map((name) => ({ name })) });
    return merged;
  }

  async getDefaultBranch(): Promise<string> {
    return "main";
  }

  async listPullRequestReviews(): Promise<ReviewPayload[]> {
    return [];
  }

  async getPullRequest(pullNumber: number): Promise<PullRequestPayload> {
    const pullRequest = this.pullRequests.get(pullNumber);
    if (pullRequest === undefined) throw new Error(`unknown pull request ${pullNumber}`);
    return pullRequest;
  }

  async listIssuesWithLabel(label: string): Promise<IssuePayload[]> {
    return [...this.issues.values()].filter((issue) => labelNames(issue.labels).includes(label));
  }
}

export interface FakeWorkspaceState {
  changedPaths: string[];
  addedLines?: number;
  removedLines?: number;
  tooLarge?: boolean;
  secretDetected?: boolean;
  pushError?: WorkspaceError;
  branches: string[];
  pushedBranches: string[];
  commits: string[];
  credentialArguments: string[][];
}

export function fakeWorkspaceState(changedPaths: string[] = []): FakeWorkspaceState {
  return {
    changedPaths,
    branches: [],
    pushedBranches: [],
    commits: [],
    credentialArguments: [],
  };
}

/**
 * A structural stand-in for `Workspace`. It records every call and reproduces the
 * failure modes the orchestrator must classify, without touching a real repository.
 */
class FakeWorkspace {
  private readonly state: FakeWorkspaceState;
  private branch: string | null = null;

  constructor(state: FakeWorkspaceState) {
    this.state = state;
  }

  async createBranch(): Promise<string> {
    const branch = `agent/999-test-branch${this.state.branches.length === 0 ? "" : `-${this.state.branches.length + 1}`}`;
    this.state.branches.push(branch);
    this.branch = branch;
    return branch;
  }

  async stageChanges(): Promise<{
    changedPaths: string[];
    addedLines: number;
    removedLines: number;
    tooLarge: boolean;
    cause: "changed-paths" | "diff-lines" | null;
  }> {
    return {
      changedPaths: this.state.changedPaths,
      addedLines: this.state.addedLines ?? this.state.changedPaths.length,
      removedLines: this.state.removedLines ?? 0,
      tooLarge: this.state.tooLarge === true,
      cause: this.state.tooLarge === true ? "changed-paths" : null,
    };
  }

  scanStagedChanges(): { detected: boolean; paths: string[]; redactedPaths: string[] } {
    const detected = this.state.secretDetected === true;
    return { detected, paths: detected ? this.state.changedPaths : [], redactedPaths: [] };
  }

  async commit(message: string): Promise<void> {
    this.state.commits.push(message);
  }

  async pushWithCredential(token: string): Promise<void> {
    this.state.credentialArguments.push(["push", this.branch ?? "", token]);
    if (this.state.pushError !== undefined) throw this.state.pushError;
    this.state.pushedBranches.push(this.branch ?? "");
  }
}

export interface HarnessOptions {
  limits?: Partial<AgentConfig["limits"]>;
  stubEnv?: Record<string, string>;
  workspace?: FakeWorkspaceState;
  now?: () => Date;
  runId?: string;
  env?: Record<string, string>;
  getuid?: () => number;
}

export interface Harness {
  github: FakeGitHub;
  orchestrator: Orchestrator;
  workspace: FakeWorkspaceState;
  loaded: LoadedConfig;
  runId: string;
  sessionDir: string;
}

export function makeHarness(options: HarnessOptions = {}): Harness {
  const base = loadConfig(process.cwd());
  const loaded: LoadedConfig = {
    ...base,
    config: {
      ...base.config,
      ...(options.limits === undefined ? {} : { limits: { ...base.config.limits, ...options.limits } }),
    },
  };
  const github = new FakeGitHub();
  github.setPermission("maintainer", "write");
  github.setPermission("owner", "admin");
  github.setPermission("reader", "read");

  const workspace = options.workspace ?? fakeWorkspaceState([]);
  const sessionDir = mkdtempSync(join(tmpdir(), "agent-sessions-"));
  const stubPath = resolve(process.cwd(), "dist", "tests", "stub-pi.js");
  const runId = options.runId ?? `run-${Math.random().toString(36).slice(2, 10)}`;

  const env: NodeJS.ProcessEnv = {
    PATH: process.env["PATH"] ?? "",
    HOME: process.env["HOME"] ?? "",
    GITHUB_TOKEN: "test-token-value",
    OLLAMA_API_KEY: "test-provider-key",
    ...options.env,
  };

  const orchestratorOptions: OrchestratorOptions = {
    client: github,
    loaded,
    repoRoot: process.cwd(),
    runId,
    sessionDir,
    environment: env,
    secrets: ["test-token-value", "test-provider-key"],
    ...(options.now === undefined ? {} : { now: options.now }),
    piRuntime: { nodePath: process.execPath, entry: stubPath, version: "1.4.0" },
    ...(options.getuid === undefined ? {} : { getuid: options.getuid }),
    headSha: async () => "abc1234",
    workspaceFactory: () => new FakeWorkspace(workspace) as unknown as Workspace,
    log: () => undefined,
  };

  // Stub behaviour is read from the environment of the spawned process.
  for (const [key, value] of Object.entries(options.stubEnv ?? {})) {
    env[key] = value;
  }
  env["STUB_PI_LOG"] = join(sessionDir, `stub-${runId}.jsonl`);

  return {
    github,
    orchestrator: new Orchestrator(orchestratorOptions),
    workspace,
    loaded,
    runId,
    sessionDir,
  };
}

export function stubLogPath(harness: Harness): string {
  return join(harness.sessionDir, `stub-${harness.runId}.jsonl`);
}
