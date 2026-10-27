/**
 * Map a GitHub event payload to a Trigger (data-model §2, FR-003, FR-022, FR-026).
 *
 * `issues.opened` is only a pre-check: it starts nothing unless the request label
 * is already present. The request label, `retry`, and `continue` are the only
 * entry points that can start work.
 */

import { sha256 } from "./config.js";
import { labelNames, type IssuePayload } from "./github.js";

export type TriggerOrigin = "label" | "retry-command" | "continue-command";

export interface RequestSnapshot {
  requestText: string;
  /** Issue `updated_at` plus a hash of the body, so an edit is always visible. */
  requestVersion: string;
}

export interface Trigger extends RequestSnapshot {
  origin: TriggerOrigin;
  event: string;
  actor: string;
  at: string;
  issueNumber: number;
  issueTitle: string;
  labels: string[];
  commandId?: string;
}

export interface RepositoryIdentity {
  owner: string;
  name: string;
  fullName: string;
}

export interface ParsedEventPayload {
  action?: string;
  issue?: IssuePayload;
  comment?: {
    id: number;
    body: string | null;
    user: { login: string } | null;
    created_at: string;
  };
  label?: { name?: string };
  pull_request?: {
    number: number;
    title: string;
    body: string | null;
    state: "open" | "closed";
    merged: boolean;
    merged_at: string | null;
    merged_by: { login: string } | null;
    user: { login: string } | null;
    head: { ref: string; sha: string };
    base: { ref: string };
    html_url: string;
    draft: boolean;
    labels: Array<string | { name?: string }>;
    closed_at: string | null;
  };
  review?: {
    id: number;
    user: { login: string } | null;
    state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";
    body: string | null;
    submitted_at: string | null;
  };
  repository?: { full_name?: string; name?: string; owner?: { login?: string } };
  sender?: { login?: string };
}

export function snapshotRequest(issue: Pick<IssuePayload, "title" | "body" | "updated_at">): RequestSnapshot {
  const requestText = `${issue.title}\n\n${issue.body ?? ""}`.trim();
  return {
    requestText,
    requestVersion: sha256(`${issue.updated_at}\n${issue.body ?? ""}`),
  };
}

export function repositoryIdentity(payload: ParsedEventPayload): RepositoryIdentity | null {
  const repository = payload.repository;
  if (!repository?.full_name) return null;
  const parts = repository.full_name.split("/");
  const owner = repository.owner?.login ?? parts[0] ?? "";
  const name = repository.name ?? parts[1] ?? "";
  if (owner.length === 0 || name.length === 0) return null;
  return { owner, name, fullName: repository.full_name };
}

function buildTrigger(
  issue: IssuePayload,
  origin: TriggerOrigin,
  event: string,
  actor: string,
  at: string,
  commandId?: string,
): Trigger {
  return {
    ...snapshotRequest(issue),
    origin,
    event,
    actor,
    at,
    issueNumber: issue.number,
    issueTitle: issue.title,
    labels: labelNames(issue.labels),
    ...(commandId === undefined ? {} : { commandId }),
  };
}

/**
 * Parse an `issues` event. Returns null when the event must not start work, which
 * includes `issues.opened` without the request label and a labelled event for any
 * label other than the request label.
 */
export function parseIssueTrigger(
  eventName: string,
  payload: ParsedEventPayload,
  labels: { request: string },
): Trigger | null {
  if (eventName !== "issues") return null;
  const issue = payload.issue;
  if (!issue) return null;
  const presentLabels = labelNames(issue.labels);
  const actor = payload.sender?.login ?? issue.user?.login ?? "unknown";
  const at = payload.comment?.created_at ?? issue.updated_at;

  if (payload.action === "opened") {
    // A pre-check only: no run without the request label, even at creation time.
    if (!presentLabels.includes(labels.request)) return null;
    return buildTrigger(issue, "label", "issues.opened", actor, at);
  }

  if (payload.action === "labeled") {
    if (payload.label?.name !== labels.request) return null;
    // The payload's issue carries the label; accept the event's label as present too,
    // because a delivery is authoritative for the transition it describes.
    if (!presentLabels.includes(labels.request) && payload.label?.name !== labels.request) return null;
    return buildTrigger(issue, "label", "issues.labeled", actor, at);
  }

  return null;
}

/**
 * Build a Trigger for a command word that continues an existing request.
 * Only `retry` and `continue` are entry points (FR-026, FR-031).
 */
export function commandTrigger(
  issue: IssuePayload,
  command: { word: string; commandId: string; actor: string; at: string },
): Trigger | null {
  const origin: TriggerOrigin | null =
    command.word === "retry" ? "retry-command" : command.word === "continue" ? "continue-command" : null;
  if (origin === null) return null;
  const event = origin === "retry-command" ? "issues.retry-command" : "issues.continue-command";
  return buildTrigger(issue, origin, event, command.actor, command.at, command.commandId);
}

/** Read the event name and payload path from the environment. */
export function eventCoordinates(env: NodeJS.ProcessEnv): { eventName: string; payloadPath: string } {
  const eventName = env["GITHUB_EVENT_NAME"] ?? "unknown";
  const payloadPath = env["GITHUB_EVENT_PATH"] ?? "";
  if (payloadPath.length === 0) {
    throw new Error("GITHUB_EVENT_PATH is not set; cannot read the event payload");
  }
  return { eventName, payloadPath };
}
