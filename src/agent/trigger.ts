import { AgentError } from "./errors.js";
import type { PermissionLevel, Trigger } from "./state.js";

export interface TriggerCandidate {
  kind: "label" | "resume-command";
  actor: string;
  at: string;
  issueNumber: number;
  commentId: number | null;
  commandText: string | null;
  labelName: string | null;
}

export interface TriggerConfig {
  triggerLabel: string;
  resumeCommand: string;
}

export interface TriggerPayload {
  action?: string;
  issue?: {
    number?: number;
    title?: string;
    body?: string;
    state?: string;
    pull_request?: unknown;
    labels?: Array<{ name?: string }>;
  };
  label?: { name?: string };
  comment?: {
    id?: number;
    body?: string;
    user?: { login?: string; type?: string };
    created_at?: string;
  };
  sender?: { login?: string; type?: string };
}

export function firstLine(body: string): string {
  return body.split(/\r?\n/, 1)[0] ?? "";
}

export function isBotUser(user: { login?: string; type?: string } | undefined): boolean {
  if (!user) {
    return false;
  }
  return user.type === "Bot" || (user.login ?? "").endsWith("[bot]");
}

export function matchesResumeCommand(body: string, command: string): boolean {
  const line = firstLine(body).trim();
  if (!line.startsWith(command)) {
    return false;
  }
  const remainder = line.slice(command.length);
  return remainder.length === 0 || /^\s/.test(remainder);
}

export function resumeCommandText(body: string, command: string): string {
  const line = firstLine(body).trim();
  const remainder = line.slice(command.length).trim();
  const rest = body.split(/\r?\n/).slice(1).join("\n").trim();
  return [remainder, rest].filter((part) => part.length > 0).join("\n");
}

function requireIssueNumber(payload: TriggerPayload): number {
  const value = payload.issue?.number;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new AgentError("trigger", "event has no valid issue number");
  }
  return value;
}

function requireActor(payload: TriggerPayload): string {
  const login = payload.sender?.login;
  if (typeof login !== "string" || login.length === 0) {
    throw new AgentError("trigger", "event has no sender login");
  }
  return login;
}

function requireTimestamp(payload: TriggerPayload): string {
  const commentTime = payload.comment?.created_at;
  return typeof commentTime === "string" && commentTime.length > 0
    ? commentTime
    : new Date().toISOString();
}

export function parseTrigger(
  eventName: string,
  payload: TriggerPayload,
  config: TriggerConfig,
): TriggerCandidate | null {
  if (eventName === "issues" && payload.action === "labeled") {
    if (payload.label?.name !== config.triggerLabel) {
      return null;
    }
    if (payload.issue?.state !== "open") {
      return null;
    }
    return {
      kind: "label",
      actor: requireActor(payload),
      at: requireTimestamp(payload),
      issueNumber: requireIssueNumber(payload),
      commentId: null,
      commandText: null,
      labelName: config.triggerLabel,
    };
  }

  if (eventName === "issue_comment" && payload.action === "created") {
    if (payload.issue?.pull_request) {
      return null;
    }
    if (payload.issue?.state !== "open") {
      return null;
    }
    if (isBotUser(payload.comment?.user)) {
      return null;
    }
    const body = payload.comment?.body ?? "";
    if (!matchesResumeCommand(body, config.resumeCommand)) {
      return null;
    }
    const commentId = payload.comment?.id;
    if (typeof commentId !== "number" || !Number.isSafeInteger(commentId)) {
      throw new AgentError("trigger", "resume comment has no valid id");
    }
    return {
      kind: "resume-command",
      actor: requireActor(payload),
      at: requireTimestamp(payload),
      issueNumber: requireIssueNumber(payload),
      commentId,
      commandText: resumeCommandText(body, config.resumeCommand),
      labelName: null,
    };
  }

  return null;
}

export function toTrigger(candidate: TriggerCandidate, permission: PermissionLevel): Trigger {
  return {
    kind: candidate.kind,
    actor: candidate.actor,
    permission,
    at: candidate.at,
    commentId: candidate.commentId,
    commandText: candidate.commandText,
    labelName: candidate.labelName,
  };
}

export function hasTriggerLabel(
  issue: { labels?: Array<{ name?: string }> },
  triggerLabel: string,
): boolean {
  return (issue.labels ?? []).some((label) => label.name === triggerLabel);
}
