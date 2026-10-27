/**
 * Thread reading, message markers, and idempotent posting
 * (contracts/thread-messages.md, FR-016).
 *
 * `agent:status` is unique per issue and rewritten from its own append-only rows.
 * Every other message is appended once, keyed on marker + run id + kind, so a
 * re-delivered event produces nothing new.
 */

import type { IssueCommentPayload, IssuePayload } from "./github.js";
import { marker, type MessageKind, type StatusInput, renderStatus } from "./messages.js";
import { parseStatusComment, StateLog } from "./state-log.js";

export interface ThreadClient {
  getIssue(issueNumber: number): Promise<IssuePayload>;
  listIssueComments(issueNumber: number): Promise<IssueCommentPayload[]>;
  createIssueComment(issueNumber: number, body: string): Promise<IssueCommentPayload>;
  updateIssueComment(commentId: number, body: string): Promise<IssueCommentPayload>;
}

export interface ThreadSnapshot {
  issue: IssuePayload;
  comments: IssueCommentPayload[];
}

function markerPrefix(kind: MessageKind, issueNumber: number): string {
  return `<!-- agent:${kind} issue=${issueNumber}`;
}

/** Extract the marker line of a comment body, if any. */
export function markerOf(body: string | null): string | null {
  if (body === null) return null;
  const firstLine = body.split("\n", 1)[0]?.trim();
  if (firstLine === undefined) return null;
  return firstLine.startsWith("<!-- agent:") ? firstLine : null;
}

export function hasIdempotencyKey(body: string | null, kind: MessageKind, issueNumber: number, runId: string): boolean {
  const line = markerOf(body);
  if (line === null) return false;
  const expected = marker(kind, issueNumber, runId);
  return line === expected;
}

export class Thread {
  private readonly client: ThreadClient;
  private readonly issueNumber: number;
  private snapshot: ThreadSnapshot | null = null;

  constructor(client: ThreadClient, issueNumber: number) {
    this.client = client;
    this.issueNumber = issueNumber;
  }

  get number(): number {
    return this.issueNumber;
  }

  async read(): Promise<ThreadSnapshot> {
    const [issue, comments] = await Promise.all([
      this.client.getIssue(this.issueNumber),
      this.client.listIssueComments(this.issueNumber),
    ]);
    this.snapshot = { issue, comments };
    return this.snapshot;
  }

  cached(): ThreadSnapshot | null {
    return this.snapshot;
  }

  invalidate(): void {
    this.snapshot = null;
  }

  async comments(): Promise<IssueCommentPayload[]> {
    if (this.snapshot === null) await this.read();
    return this.snapshot?.comments ?? [];
  }

  findComment(kind: MessageKind, runId?: string): IssueCommentPayload | null {
    if (this.snapshot === null) return null;
    const prefix = markerPrefix(kind, this.issueNumber);
    for (const comment of this.snapshot.comments) {
      const line = markerOf(comment.body);
      if (line === null || !line.startsWith(prefix)) continue;
      if (runId !== undefined && !line.includes(`run=${runId}`)) continue;
      return comment;
    }
    return null;
  }

  /** Post once. Returns null when the message already exists. */
  async postOnce(kind: MessageKind, runId: string, body: string): Promise<IssueCommentPayload | null> {
    const existing = (await this.comments()).find((comment) =>
      hasIdempotencyKey(comment.body, kind, this.issueNumber, runId),
    );
    if (existing !== undefined) return null;
    const created = await this.client.createIssueComment(this.issueNumber, body);
    this.snapshot?.comments.push(created);
    return created;
  }

  /**
   * The single status comment. On first use it is created; afterwards its body is
   * replaced with the current log, whose rows are append-only.
   */
  async upsertStatus(log: StateLog, view: Omit<StatusInput, "issueNumber" | "rows" | "notes">): Promise<IssueCommentPayload> {
    const body = renderStatus({
      ...view,
      issueNumber: this.issueNumber,
      rows: log.toStatusRows(),
      notes: log.notes,
    });
    const existing = this.findComment("status") ?? (await this.findStatusFromRemote());
    if (existing === null) {
      const created = await this.client.createIssueComment(this.issueNumber, body);
      this.snapshot?.comments.push(created);
      return created;
    }
    const updated = await this.client.updateIssueComment(existing.id, body);
    if (this.snapshot !== null) {
      const index = this.snapshot.comments.findIndex((comment) => comment.id === existing.id);
      if (index >= 0) this.snapshot.comments[index] = updated;
    }
    return updated;
  }

  /** Load the existing log so a later run appends to it instead of rewriting it. */
  async loadStateLog(): Promise<StateLog> {
    const existing = this.findComment("status") ?? (await this.findStatusFromRemote());
    if (existing?.body === null || existing?.body === undefined) return new StateLog();
    return parseStatusComment(existing.body);
  }

  private async findStatusFromRemote(): Promise<IssueCommentPayload | null> {
    const prefix = markerPrefix("status", this.issueNumber);
    const comments = await this.client.listIssueComments(this.issueNumber);
    for (const comment of comments) {
      const line = markerOf(comment.body);
      if (line !== null && line.startsWith(prefix)) return comment;
    }
    return null;
  }
}

/** True when the body carries the status marker for this issue. */
export function isStatusMessage(body: string | null, issueNumber: number): boolean {
  const line = markerOf(body);
  return line !== null && line.startsWith(markerPrefix("status", issueNumber));
}
