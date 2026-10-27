/**
 * Thin REST client over the Node built-in `fetch` (contracts/config.md, FR-021).
 *
 * Deliberately absent: any merge, approve, dismiss-review, force-push, or
 * release method. The orchestrator can propose and record, never finalize
 * (FR-007, FR-008). A unit test asserts that this surface stays absent.
 */

export interface FetchResponseLike {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<FetchResponseLike>;

export interface GitHubUser {
  login: string;
}

export interface IssuePayload {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  labels: Array<string | { name?: string }>;
  user: GitHubUser | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  html_url: string;
}

export interface IssueCommentPayload {
  id: number;
  body: string | null;
  user: GitHubUser | null;
  created_at: string;
  updated_at: string;
  html_url: string;
}

export interface PullRequestPayload {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  merged: boolean;
  merged_at: string | null;
  merged_by: GitHubUser | null;
  user: GitHubUser | null;
  head: { ref: string; sha: string };
  base: { ref: string };
  html_url: string;
  draft: boolean;
  labels: Array<string | { name?: string }>;
}

export interface ReviewPayload {
  id: number;
  user: GitHubUser | null;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";
  body: string | null;
  submitted_at: string | null;
}

export interface CollaboratorPermissionPayload {
  permission: "admin" | "maintain" | "write" | "triage" | "read" | "none";
  user: GitHubUser | null;
}

export interface IssueTimelineEvent {
  event: string;
  actor: GitHubUser | null;
  created_at: string;
  label?: { name?: string };
}

export interface CreatePullRequestInput {
  title: string;
  head: string;
  base: string;
  body: string;
  draft?: boolean;
  labels?: string[];
}

export interface GitHubClientOptions {
  token: string;
  repository: string;
  apiBaseUrl?: string;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  maxRateLimitRetries?: number;
  maxPages?: number;
}

export class GitHubError extends Error {
  readonly status: number;
  readonly rateLimited: boolean;
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
    this.body = body;
    this.rateLimited = status === 429 || (status === 403 && /rate limit/i.test(body));
  }
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class GitHubClient {
  private readonly token: string;
  private readonly repository: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRateLimitRetries: number;
  private readonly maxPages: number;

  constructor(options: GitHubClientOptions) {
    if (options.token.trim().length === 0) throw new GitHubError("missing GitHub token", 401, "");
    if (!/^[^/]+\/[^/]+$/.test(options.repository)) {
      throw new GitHubError(`invalid repository: ${options.repository}`, 400, "");
    }
    this.token = options.token;
    this.repository = options.repository;
    this.apiBaseUrl = (options.apiBaseUrl ?? "https://api.github.com").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as Promise<FetchResponseLike>);
    this.sleep = options.sleep ?? defaultSleep;
    this.maxRateLimitRetries = options.maxRateLimitRetries ?? 3;
    this.maxPages = options.maxPages ?? 10;
  }

  get repositoryName(): string {
    return this.repository;
  }

  async getDefaultBranch(): Promise<string> {
    const data = await this.request<{ default_branch: string }>("GET", `/repos/${this.repository}`);
    return data.default_branch;
  }

  async getIssue(issueNumber: number): Promise<IssuePayload> {
    return this.request<IssuePayload>("GET", `/repos/${this.repository}/issues/${issueNumber}`);
  }

  async listIssuesWithLabel(label: string): Promise<IssuePayload[]> {
    return this.paginate<IssuePayload>(
      `/repos/${this.repository}/issues?state=open&labels=${encodeURIComponent(label)}`,
    );
  }

  async listIssueComments(issueNumber: number): Promise<IssueCommentPayload[]> {
    return this.paginate<IssueCommentPayload>(`/repos/${this.repository}/issues/${issueNumber}/comments`);
  }

  async createIssueComment(issueNumber: number, body: string): Promise<IssueCommentPayload> {
    return this.request<IssueCommentPayload>("POST", `/repos/${this.repository}/issues/${issueNumber}/comments`, {
      body,
    });
  }

  async updateIssueComment(commentId: number, body: string): Promise<IssueCommentPayload> {
    return this.request<IssueCommentPayload>("PATCH", `/repos/${this.repository}/issues/comments/${commentId}`, {
      body,
    });
  }

  async addLabels(issueNumber: number, labels: string[]): Promise<unknown> {
    if (labels.length === 0) return [];
    return this.request<unknown>("POST", `/repos/${this.repository}/issues/${issueNumber}/labels`, { labels });
  }

  async removeLabel(issueNumber: number, label: string): Promise<void> {
    await this.request<unknown>(
      "DELETE",
      `/repos/${this.repository}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`,
    );
  }

  async listIssueTimeline(issueNumber: number): Promise<IssueTimelineEvent[]> {
    return this.paginate<IssueTimelineEvent>(
      `/repos/${this.repository}/issues/${issueNumber}/timeline`,
      "application/vnd.github+json",
    );
  }

  async getCollaboratorPermission(login: string): Promise<CollaboratorPermissionPayload> {
    return this.request<CollaboratorPermissionPayload>(
      "GET",
      `/repos/${this.repository}/collaborators/${encodeURIComponent(login)}/permission`,
    );
  }

  async createPullRequest(input: CreatePullRequestInput): Promise<PullRequestPayload> {
    return this.request<PullRequestPayload>("POST", `/repos/${this.repository}/pulls`, {
      title: input.title,
      head: input.head,
      base: input.base,
      body: input.body,
      draft: input.draft ?? false,
    });
  }

  async getPullRequest(pullNumber: number): Promise<PullRequestPayload> {
    return this.request<PullRequestPayload>("GET", `/repos/${this.repository}/pulls/${pullNumber}`);
  }

  async listPullRequestReviews(pullNumber: number): Promise<ReviewPayload[]> {
    return this.paginate<ReviewPayload>(`/repos/${this.repository}/pulls/${pullNumber}/reviews`);
  }

  async listPullRequestFiles(pullNumber: number): Promise<Array<{ filename: string }>> {
    return this.paginate<{ filename: string }>(`/repos/${this.repository}/pulls/${pullNumber}/files`);
  }

  async setPullRequestLabels(pullNumber: number, labels: string[]): Promise<unknown> {
    return this.request<unknown>("POST", `/repos/${this.repository}/issues/${pullNumber}/labels`, { labels });
  }

  private async request<T>(method: string, path: string, body?: unknown, accept?: string): Promise<T> {
    let attempt = 0;
    for (;;) {
      const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
        method,
        headers: {
          accept: accept ?? "application/vnd.github+json",
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
          "user-agent": "agentic-playground-agent",
          "x-github-api-version": "2022-11-28",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

      if (response.status === 204) return undefined as T;
      const text = await response.text();
      if (response.ok) {
        return (text.length === 0 ? undefined : JSON.parse(text)) as T;
      }

      const error = new GitHubError(`${method} ${path} failed with ${response.status}`, response.status, text);
      const retryAfterSeconds = Number(response.headers.get("retry-after") ?? Number.NaN);
      const remaining = response.headers.get("x-ratelimit-remaining");
      const resetSeconds = Number(response.headers.get("x-ratelimit-reset") ?? Number.NaN);
      const resetInSeconds = Number.isFinite(resetSeconds)
        ? Math.max(0, resetSeconds - Math.floor(Date.now() / 1000))
        : 1;
      const canRetry =
        error.rateLimited &&
        (remaining === null || remaining === "0" || response.status === 429) &&
        attempt < this.maxRateLimitRetries;

      if (!canRetry) throw error;
      const delayMs = Math.min(
        60_000,
        (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds : resetInSeconds) * 1000,
      );
      attempt += 1;
      await this.sleep(Math.max(250, delayMs));
    }
  }

  private async paginate<T>(path: string, accept?: string): Promise<T[]> {
    const results: T[] = [];
    let nextUrl: string | null = `${this.apiBaseUrl}${path}${path.includes("?") ? "&" : "?"}per_page=100`;
    let page = 0;
    while (nextUrl !== null && page < this.maxPages) {
      const response = await this.fetchImpl(nextUrl, {
        method: "GET",
        headers: {
          accept: accept ?? "application/vnd.github+json",
          authorization: `Bearer ${this.token}`,
          "user-agent": "agentic-playground-agent",
          "x-github-api-version": "2022-11-28",
        },
      });
      const text = await response.text();
      if (!response.ok) {
        throw new GitHubError(`GET ${nextUrl} failed with ${response.status}`, response.status, text);
      }
      const pageItems = text.length === 0 ? [] : (JSON.parse(text) as T[]);
      results.push(...pageItems);
      nextUrl = parseNextLink(response.headers.get("link"));
      page += 1;
      if (pageItems.length === 0) break;
    }
    return results;
  }
}

/** Parse an RFC 5988 `Link` header and return the `rel="next"` target. */
export function parseNextLink(header: string | null): string | null {
  if (header === null) return null;
  for (const part of header.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part.trim());
    if (match && match[1] !== undefined) return match[1];
  }
  return null;
}

/** Label names of an issue or pull request, as plain strings. */
export function labelNames(labels: Array<string | { name?: string }>): string[] {
  return labels
    .map((label) => (typeof label === "string" ? label : (label.name ?? "")))
    .filter((name) => name.length > 0);
}
