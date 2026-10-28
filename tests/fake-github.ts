import type {
  Branch,
  GitHubClient,
  Issue,
  IssueComment,
  PullRequest,
  Repository,
} from "../src/agent/github.js";

export interface FakeIssueSeed {
  number: number;
  title: string;
  body?: string;
  state?: "open" | "closed";
  labels?: string[];
  author?: string;
  updatedAt?: string;
}

export class FakeGitHub implements GitHubClient {
  readonly owner = "owner";
  readonly repo = "repo";
  readonly defaultBranch = "main";
  readonly issue: Issue;
  readonly comments: IssueComment[] = [];
  readonly permissions = new Map<string, string>();
  readonly branches = new Map<string, Branch>();
  readonly pullRequests: PullRequest[] = [];
  readonly removedLabels: string[] = [];
  private nextCommentId = 1000;
  private nextPullNumber = 1;

  constructor(seed: FakeIssueSeed) {
    this.issue = {
      number: seed.number,
      title: seed.title,
      body: seed.body ?? "A small task.",
      user: { login: seed.author ?? "reporter", type: "User" },
      state: seed.state ?? "open",
      labels: (seed.labels ?? []).map((name) => ({ name })),
      created_at: "2026-10-28T10:00:00Z",
      updated_at: seed.updatedAt ?? "2026-10-28T10:00:00Z",
      html_url: `https://github.com/owner/repo/issues/${seed.number}`,
    };
    this.permissions.set("maintainer", "write");
    this.permissions.set("reader", "read");
  }

  async getIssue(): Promise<Issue> {
    return { ...this.issue, labels: [...this.issue.labels] };
  }

  async listComments(): Promise<IssueComment[]> {
    return this.comments.map((comment) => ({ ...comment }));
  }

  async createComment(
    _owner: string,
    _repo: string,
    _issueNumber: number,
    body: string,
  ): Promise<IssueComment> {
    const comment: IssueComment = {
      id: this.nextCommentId++,
      body,
      user: { login: "github-actions[bot]", type: "Bot" },
      created_at: "2026-10-28T10:01:00Z",
    };
    this.comments.push(comment);
    return { ...comment };
  }

  async updateComment(
    _owner: string,
    _repo: string,
    commentId: number,
    body: string,
  ): Promise<IssueComment> {
    const index = this.comments.findIndex((comment) => comment.id === commentId);
    if (index < 0) {
      throw new Error(`comment ${commentId} not found`);
    }
    const next: IssueComment = { ...this.comments[index]!, body };
    this.comments[index] = next;
    return { ...next };
  }

  async addLabel(_owner: string, _repo: string, _issueNumber: number, label: string): Promise<void> {
    if (!this.issue.labels.some((entry) => entry.name === label)) {
      this.issue.labels.push({ name: label });
    }
  }

  async removeLabel(
    _owner: string,
    _repo: string,
    _issueNumber: number,
    label: string,
  ): Promise<void> {
    this.removedLabels.push(label);
    this.issue.labels = this.issue.labels.filter((entry) => entry.name !== label);
  }

  async getCollaboratorPermission(
    _owner: string,
    _repo: string,
    username: string,
  ): Promise<string> {
    return this.permissions.get(username) ?? "none";
  }

  async getRepository(): Promise<Repository> {
    return {
      default_branch: this.defaultBranch,
      full_name: `${this.owner}/${this.repo}`,
      name: this.repo,
      owner: { login: this.owner },
    };
  }

  async getBranch(_owner: string, _repo: string, branch: string): Promise<Branch | null> {
    return this.branches.get(branch) ?? null;
  }

  async listBranches(): Promise<Branch[]> {
    return [...this.branches.values()];
  }

  async listPullRequests(_owner: string, _repo: string, head: string): Promise<PullRequest[]> {
    return this.pullRequests.filter(
      (pull: PullRequest) => pull.state === "open" && `${this.owner}:${pull.head.ref}` === head,
    );
  }

  async createPullRequest(
    _owner: string,
    _repo: string,
    input: { title: string; head: string; base: string; body: string },
  ): Promise<PullRequest> {
    const pull: PullRequest = {
      number: this.nextPullNumber++,
      html_url: `https://github.com/owner/repo/pull/${this.nextPullNumber - 1}`,
      state: "open",
      merged: false,
      merged_by: null,
      merged_at: null,
      head: {
        ref: input.head,
        sha: "head-sha",
        repo: { name: this.repo, owner: { login: this.owner } },
      },
      base: { ref: input.base },
      body: input.body,
      title: input.title,
    };
    this.pullRequests.push(pull);
    return { ...pull };
  }

  async getPullRequest(_owner: string, _repo: string, pullNumber: number): Promise<PullRequest> {
    const pull = this.pullRequests.find((entry) => entry.number === pullNumber);
    if (!pull) {
      throw new Error(`pull ${pullNumber} not found`);
    }
    return { ...pull };
  }

  stateComment(): IssueComment | undefined {
    return [...this.comments].reverse().find((comment) => comment.body.includes("agent-session-state"));
  }

  resultComments(): IssueComment[] {
    return this.comments.filter((comment) => comment.body.includes("<!-- agent-run:"));
  }

  noticeComments(): IssueComment[] {
    return this.comments.filter((comment) => comment.body.includes("<!-- agent-notice:"));
  }
}
