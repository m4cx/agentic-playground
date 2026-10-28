import type { WorkspaceLike } from "../src/agent/workspace.js";

export interface FakeWorkspaceOptions {
  hasChanges?: boolean;
  conflicts?: string[];
  headSha?: string;
  prepareError?: Error;
  branchMissing?: boolean;
  leakedSecrets?: string[];
}

export class FakeWorkspace implements WorkspaceLike {
  readonly root: string;
  readonly pushes: string[] = [];
  readonly commits: Array<{ subject: string; body: string }> = [];
  readonly emptyCommits: Array<{ subject: string; body: string }> = [];
  readonly prepareCalls: Array<{
    branch: string;
    defaultBranch: string;
    resume: boolean;
  }> = [];
  private changes: boolean;
  private readonly conflicts: string[];
  private currentHead: string;
  private readonly prepareError: Error | undefined;
  private readonly branchMissing: boolean;
  private readonly leakedSecrets: string[];

  constructor(root: string, options: FakeWorkspaceOptions = {}) {
    this.root = root;
    this.changes = options.hasChanges ?? true;
    this.conflicts = options.conflicts ?? [];
    this.currentHead = options.headSha ?? "base-sha";
    this.prepareError = options.prepareError;
    this.branchMissing = options.branchMissing ?? false;
    this.leakedSecrets = options.leakedSecrets ?? [];
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
    if (this.prepareError) {
      throw this.prepareError;
    }
    this.prepareCalls.push({
      branch: input.branch,
      defaultBranch: input.defaultBranch,
      resume: input.resume,
    });
    return {
      headSha: this.currentHead,
      behindBy: input.resume ? 2 : 0,
      conflicts: this.conflicts,
      diffStat: " src/file.ts | 2 +-",
      recoveredBranch: input.resume && this.branchMissing,
    };
  }

  async commitAll(subject: string, body: string): Promise<string | null> {
    if (!this.changes) {
      return null;
    }
    this.commits.push({ subject, body });
    this.currentHead = "commit-sha";
    return this.currentHead;
  }

  async commitEmpty(subject: string, body: string): Promise<string> {
    this.emptyCommits.push({ subject, body });
    this.currentHead = "empty-sha";
    return this.currentHead;
  }

  async commitWip(subject: string, body: string): Promise<string | null> {
    if (!this.changes) {
      return null;
    }
    this.commits.push({ subject, body });
    this.currentHead = "wip-sha";
    return this.currentHead;
  }

  async push(branch: string): Promise<void> {
    this.pushes.push(branch);
  }

  async headSha(): Promise<string> {
    return this.currentHead;
  }

  async diffStat(): Promise<string> {
    return " src/file.ts | 2 +-";
  }

  async changedPaths(): Promise<string[]> {
    return ["src/file.ts"];
  }

  async findSecrets(): Promise<string[]> {
    return this.leakedSecrets;
  }
}
