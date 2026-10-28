import { AgentError } from "./errors.js";
import type { PullRequest } from "./github.js";
import { issueNumberFromBranch } from "./state.js";

export type WorkflowMode = "run" | "resume" | "review";

export interface ReviewOutcome {
  kind: "pull-request" | "issue";
  issueNumber: number;
  merged: boolean;
  actor: string;
  at: string;
  pullRequestNumber: number | null;
  branch: string | null;
}

export interface EventPayload {
  action?: string;
  issue?: {
    number?: number;
    state?: string;
    pull_request?: unknown;
    labels?: Array<{ name?: string }>;
  };
  pull_request?: PullRequest;
  sender?: { login?: string };
}

export function detectMode(eventName: string, payload: EventPayload): WorkflowMode | null {
  if (eventName === "issues" && payload.action === "labeled") {
    return "run";
  }
  if (eventName === "issue_comment" && payload.action === "created") {
    return "resume";
  }
  if (
    (eventName === "pull_request" && payload.action === "closed") ||
    (eventName === "issues" && payload.action === "closed")
  ) {
    return "review";
  }
  return null;
}

export function parseReviewOutcome(eventName: string, payload: EventPayload): ReviewOutcome | null {
  if (eventName === "pull_request" && payload.action === "closed") {
    const pull = payload.pull_request;
    if (!pull) {
      return null;
    }
    const issueNumber =
      issueNumberFromBranch(pull.head.ref) ??
      (() => {
        const match = /(?:Closes|Fixes|Resolves)\s+#(\d+)/i.exec(pull.body ?? "");
        return match ? Number(match[1]) : null;
      })();
    if (!issueNumber) {
      return null;
    }
    return {
      kind: "pull-request",
      issueNumber,
      merged: pull.merged,
      actor: payload.sender?.login ?? pull.merged_by?.login ?? "unknown",
      at: pull.merged_at ?? new Date().toISOString(),
      pullRequestNumber: pull.number,
      branch: pull.head.ref,
    };
  }

  if (eventName === "issues" && payload.action === "closed") {
    const issueNumber = payload.issue?.number;
    if (typeof issueNumber !== "number" || !Number.isSafeInteger(issueNumber)) {
      throw new AgentError("trigger", "closed issue event has no valid issue number");
    }
    return {
      kind: "issue",
      issueNumber,
      merged: false,
      actor: payload.sender?.login ?? "unknown",
      at: new Date().toISOString(),
      pullRequestNumber: null,
      branch: null,
    };
  }

  return null;
}
