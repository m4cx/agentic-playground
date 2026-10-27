/**
 * Proposal creation and outcome observation (contracts/proposal.md, FR-007,
 * FR-008, FR-033).
 *
 * The orchestrator opens the pull request; only a human merge applies the change.
 * There is deliberately no call that merges, approves, or pushes to the default
 * branch from here — or anywhere in `github.ts`.
 */

import type { GitHubClient, PullRequestPayload, ReviewPayload } from "./github.js";
import type { PermissionGate } from "./permissions.js";

export interface ProposalInput {
  issueNumber: number;
  issueUrl: string;
  summary: string;
  changedPaths: readonly string[];
  notDone: readonly string[];
  verification: readonly string[];
  requestVersion: string;
  branch: string;
  base: string;
  templatesUsed?: readonly string[];
}

export function proposalTitle(summary: string, issueNumber: number): string {
  const cleaned = summary.replace(/\s+/g, " ").trim();
  const candidate = cleaned.length === 0 ? `address issue ${issueNumber}` : cleaned;
  return `${candidate} (#${issueNumber})`;
}

export function proposalBody(input: ProposalInput): string {
  const changed =
    input.changedPaths.length === 0
      ? "- none"
      : input.changedPaths.map((path) => `- \`${path}\``).join("\n");
  const notDone =
    input.notDone.length === 0 ? "- nothing outstanding" : input.notDone.map((item) => `- ${item}`).join("\n");
  const verification =
    input.verification.length === 0
      ? "- inspected the diff; no test was run"
      : input.verification.map((item) => `- ${item}`).join("\n");
  const templates =
    input.templatesUsed === undefined || input.templatesUsed.length === 0
      ? ""
      : `\n## Templates used\n\n${input.templatesUsed.map((name) => `- \`${name}\``).join("\n")}\n`;

  return `Closes #${input.issueNumber}

## What changed and why

${input.summary.trim()}

## Changed files

${changed}

## What was not done

${notDone}

## How it was verified

${verification}

## Request

- Issue: ${input.issueUrl}
- Request version: \`${input.requestVersion}\`
- Branch: \`${input.branch}\` → \`${input.base}\`
${templates}
This proposal was prepared by the agent workflow. Merging it is a human decision; the workflow never merges.
`;
}

export interface OpenProposalResult {
  pullRequest: PullRequestPayload;
}

/** Create the pull request and label it. No reviewers, never a draft. */
export async function openProposal(
  client: Pick<GitHubClient, "createPullRequest" | "setPullRequestLabels">,
  input: ProposalInput,
  proposalLabel: string,
): Promise<OpenProposalResult> {
  const pullRequest = await client.createPullRequest({
    title: proposalTitle(input.summary, input.issueNumber),
    head: input.branch,
    base: input.base,
    body: proposalBody(input),
    draft: false,
  });
  await client.setPullRequestLabels(pullRequest.number, [proposalLabel]);
  return { pullRequest };
}

/** Resolve the issue a pull request belongs to: body link first, branch second. */
export function issueNumberFromPullRequest(pullRequest: {
  body: string | null;
  head: { ref: string };
}): number | null {
  const body = pullRequest.body ?? "";
  const linked = /\b(?:closes|fixes|resolves)\s+#(\d+)\b/i.exec(body);
  if (linked?.[1] !== undefined) {
    const number = Number.parseInt(linked[1], 10);
    if (Number.isFinite(number) && number > 0) return number;
  }
  const branch = /^agent\/(\d+)-/.exec(pullRequest.head.ref);
  if (branch?.[1] !== undefined) {
    const number = Number.parseInt(branch[1], 10);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

export type ProposalDecisionKind = "approve" | "reject" | "merge" | "close";

export interface DecisionRecord {
  kind: ProposalDecisionKind;
  actor: string;
  at: string;
  source: "review" | "close";
  recorded: boolean;
  note: string;
}

/**
 * A review counts only through its state, never through its text. A review from an
 * account without write access is recorded as ignored, not as a decision.
 */
export async function reviewDecision(
  review: Pick<ReviewPayload, "state" | "user" | "submitted_at">,
  permissions: PermissionGate,
): Promise<DecisionRecord | null> {
  const kind: ProposalDecisionKind | null =
    review.state === "APPROVED" ? "approve" : review.state === "CHANGES_REQUESTED" ? "reject" : null;
  if (kind === null) return null;
  const actor = review.user?.login ?? "";
  const at = review.submitted_at ?? new Date().toISOString();
  const decision = await permissions.recheckAtDecision(actor);
  if (!decision.allowed) {
    return {
      kind,
      actor,
      at,
      source: "review",
      recorded: false,
      note: "The review was ignored: write access to this repository is required.",
    };
  }
  return {
    kind,
    actor,
    at,
    source: "review",
    recorded: true,
    note: kind === "approve" ? "Approval recorded; the merge applies the change." : "Rejection recorded.",
  };
}

export interface CloseOutcome {
  decision: DecisionRecord;
  issueState: "finished" | "rejected";
}

/**
 * A closed pull request resolves the issue. The actor is taken from the merge
 * event; when it is not observable the record says `unknown` rather than guessing.
 */
export function closeOutcome(
  pullRequest: Pick<PullRequestPayload, "merged" | "merged_by" | "merged_at" | "html_url">,
  closedAt: string,
): CloseOutcome {
  const merged = pullRequest.merged === true;
  const actor = pullRequest.merged_by?.login ?? "unknown";
  const at = merged ? (pullRequest.merged_at ?? closedAt) : closedAt;
  return {
    decision: {
      kind: merged ? "merge" : "close",
      actor,
      at,
      source: "close",
      recorded: true,
      note: merged ? "The change was applied by a human merge." : "The change was not applied.",
    },
    issueState: merged ? "finished" : "rejected",
  };
}

/** A pull request is an agent proposal only when it carries the proposal label. */
export function isAgentProposal(labels: readonly string[], proposalLabel: string): boolean {
  return labels.includes(proposalLabel);
}
