import type { Issue, IssueComment } from "./github.js";

export interface DigestComment {
  author: string;
  authorType: string;
  createdAt: string;
  body: string;
  isAgentResult: boolean;
}

export interface SessionDigest {
  issue: {
    number: number;
    title: string;
    body: string;
    author: string;
    labels: string[];
    state: string;
    createdAt: string;
    updatedAt: string;
  };
  comments: DigestComment[];
  omittedComments: number;
  truncatedComments: number;
  branchDiffStat: string;
  unresolvedConflicts: string[];
}

export interface DigestLimits {
  maxComments: number;
  maxCommentCharacters: number;
}

const STATE_MARKER = /<!--\s*agent-session-state\s+\{/;
const RESULT_MARKER = /<!--\s*agent-run:/;
const ACK_MARKER = /<!--\s*agent-ack:/;
const NOTICE_MARKER = /<!--\s*agent-notice:/;

export function findStateComment(comments: IssueComment[]): IssueComment | null {
  const matches = comments.filter((comment) => STATE_MARKER.test(comment.body));
  if (matches.length > 1) {
    return matches[matches.length - 1] ?? null;
  }
  return matches[0] ?? null;
}

export function findCommentByMarker(comments: IssueComment[], marker: string): IssueComment | null {
  return comments.find((comment) => comment.body.includes(marker)) ?? null;
}

export function hasMarker(comments: IssueComment[], marker: string): boolean {
  return comments.some((comment) => comment.body.includes(marker));
}

export function isAgentResultComment(comment: IssueComment): boolean {
  return RESULT_MARKER.test(comment.body);
}

export function isInternalComment(comment: IssueComment): boolean {
  return (
    STATE_MARKER.test(comment.body) ||
    RESULT_MARKER.test(comment.body) ||
    ACK_MARKER.test(comment.body) ||
    NOTICE_MARKER.test(comment.body)
  );
}

function truncate(body: string, maxCharacters: number): { body: string; truncated: boolean } {
  if (body.length <= maxCharacters) {
    return { body, truncated: false };
  }
  return {
    body: `${body.slice(0, maxCharacters)}\n\n[truncated ${body.length - maxCharacters} characters]`,
    truncated: true,
  };
}

export function buildDigest(
  issue: Issue,
  comments: IssueComment[],
  limits: DigestLimits,
  branchDiffStat = "",
  unresolvedConflicts: string[] = [],
): SessionDigest {
  const relevant = comments.filter((comment) => !isInternalComment(comment));
  const selected = relevant.slice(-limits.maxComments);
  let truncatedComments = 0;
  const digestComments: DigestComment[] = selected.map((comment) => {
    const { body, truncated } = truncate(comment.body, limits.maxCommentCharacters);
    if (truncated) {
      truncatedComments += 1;
    }
    return {
      author: comment.user.login,
      authorType: comment.user.type ?? "User",
      createdAt: comment.created_at,
      body,
      isAgentResult: isAgentResultComment(comment),
    };
  });

  return {
    issue: {
      number: issue.number,
      title: issue.title,
      body: issue.body ?? "",
      author: issue.user.login,
      labels: issue.labels.map((label) => label.name),
      state: issue.state,
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
    },
    comments: digestComments,
    omittedComments: Math.max(0, relevant.length - selected.length),
    truncatedComments,
    branchDiffStat,
    unresolvedConflicts,
  };
}
