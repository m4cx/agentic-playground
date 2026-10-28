import type { AgentOutput } from "./output.js";
import { redact } from "./redact.js";
import type { AgentSession, RunSummary, SessionState, StateRecord, Trigger } from "./state.js";
import { renderStateMarker } from "./state.js";

export function nextAction(state: SessionState): string {
  switch (state) {
    case "finished":
      return "Review the pull request and merge it when satisfied.";
    case "waiting":
      return "Answer the open questions with `/agent continue ...` to resume.";
    case "failed":
      return "Review the failure reason, fix the cause, then resume with `/agent continue ...`.";
    case "stopped":
      return "Reopen the issue and resume with `/agent continue ...` if work should continue.";
    case "accepted":
    case "working":
      return "No action is required while the agent is working.";
  }
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function renderStateComment(record: StateRecord): string {
  const { session, lastRun } = record;
  const lastRunText = lastRun
    ? `${lastRun.startedAt} (${lastRun.outcome ?? "running"})`
    : "not yet";
  const pr = session.pullRequestNumber ? `#${session.pullRequestNumber}` : "not yet";
  const text = [
    "### Agent session",
    "",
    "| | |",
    "|---|---|",
    `| **State** | ${session.state} |`,
    `| **Session** | ${escapeCell(session.id)} |`,
    `| **Branch** | \`${escapeCell(session.branchName)}\` |`,
    `| **Pull request** | ${pr} |`,
    `| **Last run** | ${escapeCell(lastRunText)} |`,
    `| **Request version** | \`${escapeCell(session.requestVersion)}\` |`,
    "",
    session.state === "working"
      ? "The agent is working on this issue. The latest result is posted as a separate comment."
      : `Next action: ${nextAction(session.state)}`,
    "",
    renderStateMarker(record),
  ].join("\n");
  return redact(text).text;
}

export function renderAcknowledgement(session: AgentSession, runId: string): string {
  return [
    `<!-- agent-ack:${runId} -->`,
    "### Agent session started",
    "",
    `Session **${session.id}** accepted this issue.`,
    `Work will be committed to \`${session.branchName}\` and offered as a pull request.`,
    "A result comment follows when the run ends.",
  ].join("\n");
}

export interface ResultCommentInput {
  session: AgentSession;
  run: RunSummary;
  output: AgentOutput;
  branchUrl: string | null;
  pullRequestUrl: string | null;
  blockedEgress: string[];
}

export function renderResult(input: ResultCommentInput): string {
  const { session, run, output } = input;
  const verification =
    output.verification.length > 0
      ? output.verification.map((item) => `- ${item}`).join("\n")
      : "No verification was reported.";
  const openQuestions =
    output.openQuestions.length > 0
      ? output.openQuestions.map((item) => `- ${item}`).join("\n")
      : "None.";
  const couldNotComplete =
    output.couldNotComplete.length > 0
      ? output.couldNotComplete.map((item) => `- ${item}`).join("\n")
      : "None.";
  const branch = input.branchUrl
    ? `[\`${session.branchName}\`](${input.branchUrl})`
    : `\`${session.branchName}\``;
  const pr = input.pullRequestUrl
    ? `[#${session.pullRequestNumber ?? "?"}](${input.pullRequestUrl})`
    : "not created";
  const blocked =
    input.blockedEgress.length > 0
      ? `\n\n**Blocked network attempts**\n${input.blockedEgress.map((item) => `- ${item}`).join("\n")}`
      : "";
  const text = [
    `<!-- agent-run:${run.id} -->`,
    "### Agent result",
    "",
    `**State:** ${session.state}`,
    `**Branch:** ${branch}`,
    `**Pull request:** ${pr}`,
    "",
    "**Summary**",
    output.summary,
    "",
    "**Verification**",
    verification,
    "",
    "**Open questions**",
    openQuestions,
    "",
    "**Not completed**",
    couldNotComplete,
    "",
    "**Next action**",
    nextAction(session.state),
    blocked,
  ].join("\n");
  return redact(text).text;
}

export interface FailureCommentInput {
  session: AgentSession | null;
  run: RunSummary;
  reason: string;
  message: string;
  blockedEgress: string[];
}

export function renderFailure(input: FailureCommentInput): string {
  const sessionLine = input.session
    ? `Session \`${input.session.id}\` on \`${input.session.branchName}\`.`
    : "No session state was available.";
  const blocked =
    input.blockedEgress.length > 0
      ? `\n\n**Blocked network attempts**\n${input.blockedEgress.map((item) => `- ${item}`).join("\n")}`
      : "";
  const text = [
    `<!-- agent-run:${input.run.id} -->`,
    "### Agent run failed",
    "",
    `**State:** failed`,
    `**Reason:** \`${input.reason}\``,
    `**Detail:** ${input.message}`,
    "",
    sessionLine,
    "",
    "**Next action**",
    nextAction("failed"),
    blocked,
  ].join("\n");
  return redact(text).text;
}

export interface OutcomeCommentInput {
  issueNumber: number;
  actor: string;
  at: string;
  merged: boolean;
  pullRequestNumber: number | null;
  branch: string | null;
}

export function renderOutcome(input: OutcomeCommentInput): string {
  const pr = input.pullRequestNumber ? `#${input.pullRequestNumber}` : "the pull request";
  const branch = input.branch ? ` on \`${input.branch}\`` : "";
  return [
    "### Agent review outcome",
    "",
    input.merged
      ? `${pr}${branch} was merged by **${input.actor}** at ${input.at}.`
      : `${pr}${branch} was closed without merging by **${input.actor}** at ${input.at}.`,
    "",
    input.merged
      ? "The session is finished. The feature branch remains available."
      : "The session is stopped. Reopen the issue and resume with `/agent continue ...` if work should continue.",
  ].join("\n");
}

export function renderPermissionDenied(actor: string, runId: string): string {
  return [
    `<!-- agent-notice:${runId} -->`,
    "### Agent request ignored",
    "",
    `**${actor}** does not have write access to this repository.`,
    "Only people with write, maintain, or admin permission may start or resume an agent session.",
  ].join("\n");
}

export function renderRecovery(issueNumber: number, reason: string): string {
  return [
    "### Agent session state recovered",
    "",
    `The stored state marker for issue #${issueNumber} was missing or unreadable, so the session was`,
    `rebuilt from the issue thread and the existing branch. Reason: ${reason}.`,
  ].join("\n");
}

export function renderNoSession(issueNumber: number, runId: string): string {
  return [
    `<!-- agent-notice:${runId} -->`,
    "### Agent request ignored",
    "",
    `No agent session exists for issue #${issueNumber} yet.`,
    "Apply the agent-handling label to start a session; the resume command continues an existing session.",
  ].join("\n");
}

export function describeTrigger(trigger: Trigger): string {
  if (trigger.kind === "label") {
    return `label \`${trigger.labelName ?? "unknown"}\` by ${trigger.actor}`;
  }
  return `resume command by ${trigger.actor}`;
}
