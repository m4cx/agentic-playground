import { AgentError, errorMessage } from "./errors.js";

export interface GitHubUser {
  login: string;
  type?: string;
}

export interface IssueLabel {
  name: string;
}

export interface Issue {
  number: number;
  title: string;
  body: string | null;
  user: GitHubUser;
  state: "open" | "closed";
  labels: IssueLabel[];
  created_at: string;
  updated_at: string;
  html_url: string;
}

export interface IssueComment {
  id: number;
  body: string;
  user: GitHubUser;
  created_at: string;
  updated_at?: string;
  html_url?: string;
}

export interface Repository {
  default_branch: string;
  full_name: string;
  name: string;
  owner: GitHubUser;
}

export interface Branch {
  name: string;
  commit: {
    sha: string;
  };
}

export interface PullRequest {
  number: number;
  html_url: string;
  state: "open" | "closed";
  merged: boolean;
  merged_by: GitHubUser | null;
  merged_at: string | null;
  head: {
    ref: string;
    sha: string;
    repo: { name: string; owner: GitHubUser } | null;
  };
  base: {
    ref: string;
  };
  body: string | null;
  title: string;
}

export interface GitHubClient {
  getIssue(owner: string, repo: string, issueNumber: number): Promise<Issue>;
  listComments(owner: string, repo: string, issueNumber: number): Promise<IssueComment[]>;
  createComment(owner: string, repo: string, issueNumber: number, body: string): Promise<IssueComment>;
  updateComment(owner: string, repo: string, commentId: number, body: string): Promise<IssueComment>;
  addLabel(owner: string, repo: string, issueNumber: number, label: string): Promise<void>;
  removeLabel(owner: string, repo: string, issueNumber: number, label: string): Promise<void>;
  getCollaboratorPermission(owner: string, repo: string, username: string): Promise<string>;
  getRepository(owner: string, repo: string): Promise<Repository>;
  getBranch(owner: string, repo: string, branch: string): Promise<Branch | null>;
  listBranches(owner: string, repo: string): Promise<Branch[]>;
  listPullRequests(owner: string, repo: string, head: string): Promise<PullRequest[]>;
  createPullRequest(
    owner: string,
    repo: string,
    input: { title: string; head: string; base: string; body: string },
  ): Promise<PullRequest>;
  getPullRequest(owner: string, repo: string, pullNumber: number): Promise<PullRequest>;
}

export interface RestGitHubClientOptions {
  token: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  allow404?: boolean;
}

export class RestGitHubClient implements GitHubClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: RestGitHubClientOptions) {
    this.token = options.token;
    this.baseUrl = (options.baseUrl ?? "https://api.github.com").replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(pathname: string, options: RequestOptions = {}): Promise<T | null> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
        method: options.method ?? "GET",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "agentic-playground-agent",
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      throw new AgentError("github", `GitHub request failed: ${errorMessage(error)}`);
    }

    if (response.status === 404 && options.allow404) {
      return null;
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new AgentError(
        "github",
        `GitHub ${options.method ?? "GET"} ${pathname} failed with ${response.status}: ${text.slice(0, 300)}`,
      );
    }
    if (response.status === 204) {
      return null;
    }
    return (await response.json()) as T;
  }

  async getIssue(owner: string, repo: string, issueNumber: number): Promise<Issue> {
    const result = await this.request<Issue>(`/repos/${owner}/${repo}/issues/${issueNumber}`);
    if (!result) {
      throw new AgentError("github", "issue not found");
    }
    return result;
  }

  async listComments(owner: string, repo: string, issueNumber: number): Promise<IssueComment[]> {
    const comments: IssueComment[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const batch = await this.request<IssueComment[]>(
        `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100&page=${page}`,
      );
      if (!batch || batch.length === 0) {
        break;
      }
      comments.push(...batch);
      if (batch.length < 100) {
        break;
      }
    }
    return comments;
  }

  async createComment(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string,
  ): Promise<IssueComment> {
    const result = await this.request<IssueComment>(
      `/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
      { method: "POST", body: { body } },
    );
    if (!result) {
      throw new AgentError("github", "comment creation returned no body");
    }
    return result;
  }

  async updateComment(
    owner: string,
    repo: string,
    commentId: number,
    body: string,
  ): Promise<IssueComment> {
    const result = await this.request<IssueComment>(
      `/repos/${owner}/${repo}/issues/comments/${commentId}`,
      { method: "PATCH", body: { body } },
    );
    if (!result) {
      throw new AgentError("github", "comment update returned no body");
    }
    return result;
  }

  async addLabel(owner: string, repo: string, issueNumber: number, label: string): Promise<void> {
    await this.request(`/repos/${owner}/${repo}/issues/${issueNumber}/labels`, {
      method: "POST",
      body: { labels: [label] },
    });
  }

  async removeLabel(owner: string, repo: string, issueNumber: number, label: string): Promise<void> {
    await this.request(
      `/repos/${owner}/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`,
      { method: "DELETE", allow404: true },
    );
  }

  async getCollaboratorPermission(
    owner: string,
    repo: string,
    username: string,
  ): Promise<string> {
    const result = await this.request<{ permission: string }>(
      `/repos/${owner}/${repo}/collaborators/${encodeURIComponent(username)}/permission`,
      { allow404: true },
    );
    return result?.permission ?? "none";
  }

  async getRepository(owner: string, repo: string): Promise<Repository> {
    const result = await this.request<Repository>(`/repos/${owner}/${repo}`);
    if (!result) {
      throw new AgentError("github", "repository not found");
    }
    return result;
  }

  async getBranch(owner: string, repo: string, branch: string): Promise<Branch | null> {
    return this.request<Branch>(
      `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`,
      { allow404: true },
    );
  }

  async listBranches(owner: string, repo: string): Promise<Branch[]> {
    const result = await this.request<Branch[]>(`/repos/${owner}/${repo}/branches?per_page=100`);
    return result ?? [];
  }

  async listPullRequests(owner: string, repo: string, head: string): Promise<PullRequest[]> {
    const result = await this.request<PullRequest[]>(
      `/repos/${owner}/${repo}/pulls?state=open&per_page=100&head=${encodeURIComponent(head)}`,
    );
    return result ?? [];
  }

  async createPullRequest(
    owner: string,
    repo: string,
    input: { title: string; head: string; base: string; body: string },
  ): Promise<PullRequest> {
    const result = await this.request<PullRequest>(`/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      body: input,
    });
    if (!result) {
      throw new AgentError("github", "pull request creation returned no body");
    }
    return result;
  }

  async getPullRequest(owner: string, repo: string, pullNumber: number): Promise<PullRequest> {
    const result = await this.request<PullRequest>(`/repos/${owner}/${repo}/pulls/${pullNumber}`);
    if (!result) {
      throw new AgentError("github", "pull request not found");
    }
    return result;
  }
}
