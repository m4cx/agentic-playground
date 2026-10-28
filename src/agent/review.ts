import type { GitHubClient } from "./github.js";
import { renderOutcome, renderStateComment } from "./messages.js";
import { parseStateMarker, type StateRecord } from "./state.js";
import { findStateComment, hasMarker } from "./thread.js";
import type { ReviewOutcome } from "./events.js";

export interface ReviewInput {
  client: GitHubClient;
  owner: string;
  repo: string;
  outcome: ReviewOutcome;
  now: string;
}

function outcomeMarker(outcome: ReviewOutcome): string {
  if (outcome.kind === "issue") {
    return `<!-- agent-outcome:issue:${outcome.issueNumber}:closed -->`;
  }
  return `<!-- agent-outcome:pr:${outcome.pullRequestNumber}:${outcome.merged ? "merged" : "closed"} -->`;
}

export async function handleReview(input: ReviewInput): Promise<void> {
  const issue = await input.client.getIssue(input.owner, input.repo, input.outcome.issueNumber);
  const comments = await input.client.listComments(input.owner, input.repo, issue.number);
  const stateComment = findStateComment(comments);
  if (!stateComment) {
    return;
  }
  const record = parseStateMarker(stateComment.body);
  if (!record || record.session.issueNumber !== input.outcome.issueNumber) {
    return;
  }

  if (input.outcome.kind === "pull-request") {
    if (input.outcome.branch !== record.session.branchName) {
      return;
    }
    if (
      record.session.pullRequestNumber !== null &&
      record.session.pullRequestNumber !== input.outcome.pullRequestNumber
    ) {
      return;
    }
  }

  let target: "finished" | "stopped" =
    input.outcome.kind === "issue" ? "stopped" : input.outcome.merged ? "finished" : "stopped";
  let outcomeForComment = input.outcome;

  // A merged pull request also closes its issue, so both review events can race. If the
  // issue-closed event sees a known pull request, observe the pull request itself instead
  // of guessing from the issue state.
  if (input.outcome.kind === "issue" && record.session.pullRequestNumber !== null) {
    try {
      const pull = await input.client.getPullRequest(
        input.owner,
        input.repo,
        record.session.pullRequestNumber,
      );
      target = pull.merged ? "finished" : "stopped";
      outcomeForComment = {
        kind: "pull-request",
        issueNumber: input.outcome.issueNumber,
        merged: pull.merged,
        actor: pull.merged_by?.login ?? input.outcome.actor,
        at: pull.merged_at ?? input.outcome.at,
        pullRequestNumber: pull.number,
        branch: pull.head.ref,
      };
    } catch {
      // The pull request may be unavailable; keep the issue outcome.
    }
  }

  if (record.session.state === target) {
    return;
  }
  if (record.session.state === "finished" && target === "stopped") {
    return;
  }

  const next = applyOutcomeState(record, target, input.now);
  if (!next) {
    return;
  }

  const marker = outcomeMarker(outcomeForComment);
  if (!hasMarker(comments, marker)) {
    const body = [
      marker,
      renderOutcome({
        issueNumber: outcomeForComment.issueNumber,
        actor: outcomeForComment.actor,
        at: outcomeForComment.at,
        merged: outcomeForComment.merged,
        pullRequestNumber: outcomeForComment.pullRequestNumber,
        branch: outcomeForComment.branch,
      }),
    ].join("\n");
    await input.client.createComment(input.owner, input.repo, issue.number, body);
  }

  await input.client.updateComment(input.owner, input.repo, stateComment.id, renderStateComment(next));
}

function applyOutcomeState(
  record: StateRecord,
  target: "finished" | "stopped",
  now: string,
): StateRecord | null {
  const next: StateRecord = JSON.parse(JSON.stringify(record)) as StateRecord;
  if (next.session.state === target) {
    return null;
  }
  if (next.session.state === "finished" && target === "stopped") {
    return null;
  }
  next.session.state = target;
  next.session.updatedAt = now;
  next.updatedByRun = `review-${now}`;
  next.lastRun = next.lastRun
    ? {
        ...next.lastRun,
        endedAt: next.lastRun.endedAt ?? now,
        outcome: target,
        nextAction: null,
      }
    : null;
  return next;
}
