/**
 * English message templates for the issue thread (contracts/thread-messages.md).
 *
 * The thread is the record (FR-016), so every body is a fixed English template with
 * data interpolation only. No template echoes issue prose as a translated string,
 * and the agent's own prose is quoted verbatim after redaction, if at all.
 */

import { REDACTION_PLACEHOLDER } from "./redact.js";

export const MESSAGE_KINDS = [
  "ack",
  "status",
  "feedback",
  "result",
  "error",
  "decision",
  "limit",
  "session",
  "notice",
  "outcome",
] as const;

export type MessageKind = (typeof MESSAGE_KINDS)[number];

export type FailureReason =
  | "request-unclear"
  | "request-too-large"
  | "needs-permission"
  | "content-conflict"
  | "secret-request"
  | "limit-exceeded"
  | "environment"
  | "interrupted"
  | "unexpected-retry"
  | "agent-error";

export const FAILURE_REASONS: readonly FailureReason[] = [
  "request-unclear",
  "request-too-large",
  "needs-permission",
  "content-conflict",
  "secret-request",
  "limit-exceeded",
  "environment",
  "interrupted",
  "unexpected-retry",
  "agent-error",
];

/** Marker identifying a message body. Status is unique per issue. */
export function marker(kind: MessageKind, issueNumber: number, runId?: string): string {
  const run = runId === undefined ? "" : ` run=${runId}`;
  return `<!-- agent:${kind} issue=${issueNumber}${run} -->`;
}

/** Idempotency key: the same marker, run, and kind is posted at most once. */
export function idempotencyKey(kind: MessageKind, issueNumber: number, runId: string): string {
  return `${marker(kind, issueNumber, runId)}::${kind}`;
}

export function withMarker(
  body: string,
  kind: MessageKind,
  issueNumber: number,
  runId?: string,
): string {
  return `${marker(kind, issueNumber, runId)}\n${body.trim()}\n`;
}

function bullets(items: readonly string[], emptyText: string): string {
  const lines = items.map((item) => `- ${item.trim()}`).filter((line) => line.length > 2);
  if (lines.length === 0) return `- ${emptyText}`;
  return lines.join("\n");
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

export interface AckInput {
  issueNumber: number;
  runId: string;
  continuesRunId?: string;
  actor: string;
  origin: string;
  triggeredAt: string;
  runStartedAt: string;
  queueDelaySeconds: number;
  requestVersion: string;
  instructionsPath: string;
  instructionsSha: string;
  fingerprint: string;
  model: string;
  piVersion: string;
  thinking: string;
  capUsd: number;
  priorConsumptionUsd: number | "unknown";
  coldStart?: boolean;
}

export function renderAck(input: AckInput): string {
  const continues =
    input.continuesRunId === undefined ? "" : `\n- Continues run: \`${input.continuesRunId}\``;
  const prior =
    input.priorConsumptionUsd === "unknown" ? "unknown" : money(input.priorConsumptionUsd);
  const coldStart = input.coldStart === true ? "\n- Continuity: cold start (no session was restored)" : "";
  const body = `Agent run started.

- Triggered by: @${input.actor} (${input.origin}) at ${input.triggeredAt}
- Run started: ${input.runStartedAt} — queue delay \`${Math.max(0, Math.round(input.queueDelaySeconds))}\` seconds (SC-016)
- Request version: ${input.requestVersion}
- Instructions: \`${input.instructionsPath}\` at \`${input.instructionsSha}\` (configuration fingerprint \`${input.fingerprint}\`)
- Model: \`${input.model}\` (Pi \`${input.piVersion}\`), thinking \`${input.thinking}\`
- Allowance for this issue: cap \`${money(input.capUsd)}\`; consumption recorded in this thread before this run \`${prior}\`${continues}${coldStart}

I will report the outcome here. Decisions use \`/agent <word>\`; send \`/agent help\` for the list.`;
  return withMarker(body, "ack", input.issueNumber, input.runId);
}

export interface StatusRowView {
  at: string;
  state: string;
  runId: string;
  consumed: string;
  nextAct: string;
}

export interface StatusInput {
  issueNumber: number;
  runId: string;
  state: string;
  stateMeaning: string;
  continuesRunId?: string;
  startedAt: string;
  consumedUsd: number;
  capUsd: number;
  turns: number;
  proposalUrl: string | null;
  nextAct: string;
  rows: readonly StatusRowView[];
  notes: readonly string[];
}

export function renderStatus(input: StatusInput): string {
  const continues =
    input.continuesRunId === undefined ? "" : ` (continues \`${input.continuesRunId}\`)`;
  const rowLines = input.rows
    .map(
      (row) =>
        `| ${row.at} | \`${row.state}\` | \`${row.runId}\` | ${row.consumed} | ${row.nextAct} |`,
    )
    .join("\n");
  const noteLines =
    input.notes.length === 0
      ? ""
      : `\n\n**Notes**\n\n${input.notes.map((note) => `- ${note}`).join("\n")}`;

  const body = `**State:** \`${input.state}\` — ${input.stateMeaning}

| | |
|---|---|
| Run | \`${input.runId}\`${continues} |
| Started | ${input.startedAt} |
| Consumed | \`${money(input.consumedUsd)}\` of \`${money(input.capUsd)}\` (\`${input.turns}\` turns) |
| Proposal | ${input.proposalUrl ?? "`none`"} |
| Next act needed | ${input.nextAct} |

**State log**

| At | State | Run | Consumed | Next act |
|----|-------|-----|----------|----------|
${rowLines}${noteLines}`;

  return withMarker(body, "status", input.issueNumber);
}

export interface FeedbackInput {
  issueNumber: number;
  runId: string;
  completed: readonly string[];
  notDone: readonly string[];
  resumeFrom: readonly string[];
  consumedUsd: number;
  resumeHint: "retry" | "continue";
  requestChange?: {
    actedOn: string;
    actedAt: string;
    foundNow: string;
  };
}

export function renderFeedback(input: FeedbackInput): string {
  const change =
    input.requestChange === undefined
      ? ""
      : `

**Request changed during the run**
- Acted on: \`${input.requestChange.actedOn}\` (captured at ${input.requestChange.actedAt})
- Found now: \`${input.requestChange.foundNow}\`
- Nothing further happens until a person posts \`/agent continue\`.`;

  const body = `Stopping at an action boundary.

**Completed**
${bullets(input.completed, "nothing yet")}

**Not done**
${bullets(input.notDone, "nothing outstanding")}

**State to resume from**
${bullets(input.resumeFrom, "nothing outstanding")}

Consumed so far: \`${money(input.consumedUsd)}\`. Resume with \`/agent ${input.resumeHint}\`.${change}`;

  return withMarker(body, "feedback", input.issueNumber, input.runId);
}

export type OutcomeKind = "no changes needed" | "proposal opened" | "answer only";

export interface ResultInput {
  issueNumber: number;
  runId: string;
  outcome: OutcomeKind;
  actions: readonly string[];
  proposalUrl: string | null;
  changedFiles: number;
  changedPaths: readonly string[];
  nextStep: string;
  consumedUsd: number;
  turns: number;
  toolCalls: number;
  templatesUsed?: readonly string[];
  extraNotes?: readonly string[];
}

export function renderResult(input: ResultInput): string {
  const pathList =
    input.changedFiles === 0
      ? "none"
      : input.changedPaths.slice(0, 10).join(", ") +
        (input.changedPaths.length > 10 ? ", …" : "");
  const templates =
    input.templatesUsed === undefined || input.templatesUsed.length === 0
      ? ""
      : `\n- Templates used: ${input.templatesUsed.map((name) => `\`${name}\``).join(", ")}`;
  const notes =
    input.extraNotes === undefined || input.extraNotes.length === 0
      ? ""
      : `\n\n**Notes**\n\n${input.extraNotes.map((note) => `- ${note}`).join("\n")}`;

  const body = `Run finished.

**Outcome:** ${input.outcome}

**What I did**
${bullets(input.actions, "nothing was changed")}

**Artifacts**
- Proposal: ${input.proposalUrl ?? "`none`"}
- Files changed: \`${input.changedFiles}\`${pathList === "none" ? "" : ` in ${pathList}`}${templates}

**What a human must do next**
- ${input.nextStep}

Consumed: \`${money(input.consumedUsd)}\` (\`${input.turns}\` turns, \`${input.toolCalls}\` tool calls).${notes}`;

  return withMarker(body, "result", input.issueNumber, input.runId);
}

const FAILURE_EXPLANATIONS: Record<FailureReason, string> = {
  "request-unclear": "the request is not specific enough to act on.",
  "request-too-large": "the change would be too large to review in one proposal.",
  "needs-permission": "the work needs a permission the agent does not have.",
  "content-conflict": "the base branch moved while the work was prepared.",
  "secret-request": "the work would require handling a secret, which the agent refuses.",
  "limit-exceeded": "the consumption limit for this issue was reached.",
  environment: "the run environment was not usable.",
  interrupted: "the job ended without reporting; nothing that is recorded here was lost.",
  "unexpected-retry": "the harness tried to continue on its own, which is not allowed.",
  "agent-error": "the agent ended without a usable result.",
};

const REQUESTER_ACTIONABLE: ReadonlySet<FailureReason> = new Set<FailureReason>([
  "request-unclear",
  "request-too-large",
  "content-conflict",
  "secret-request",
]);

export function failureExplanation(reason: FailureReason): string {
  return FAILURE_EXPLANATIONS[reason];
}

export function isRequesterActionable(reason: FailureReason): boolean {
  return REQUESTER_ACTIONABLE.has(reason);
}

export interface ErrorInput {
  issueNumber: number;
  runId: string;
  reason: FailureReason;
  detail?: string;
  consumedUsd: number;
  signal?: string;
}

export function renderError(input: ErrorInput): string {
  const explanation = failureExplanation(input.reason);
  const detail = input.detail === undefined || input.detail.trim().length === 0 ? "" : `\n${input.detail.trim()}\n`;
  const signal = input.signal === undefined ? "" : `\nSignal seen: \`${input.signal}\`.\n`;
  const fix = isRequesterActionable(input.reason)
    ? `yes: adjust the request in this issue and post \`/agent retry\``
    : "no: this is on the operator side";
  const interruptedNote =
    input.reason === "interrupted"
      ? '\nThe job ended without reporting; nothing was lost that is recorded here.\n'
      : "";
  const retryLine = isRequesterActionable(input.reason)
    ? "Retry with `/agent retry` if the reason is on your side."
    : "An operator needs to resolve this before a retry can succeed.";

  const body = `Run failed.

**Reason:** \`${input.reason}\` — ${explanation}
**Can you fix it?** ${fix}
${detail}${signal}${interruptedNote}
Consumed: \`${money(input.consumedUsd)}\`. ${retryLine}`;

  return withMarker(body, "error", input.issueNumber, input.runId);
}

export interface DecisionInput {
  issueNumber: number;
  runId: string;
  kind: string;
  actor: string;
  at: string;
  reason: string | null;
  applied: string;
  source: "command" | "review" | "close";
}

export function renderDecision(input: DecisionInput): string {
  const body = `Decision recorded: \`${input.kind}\`
- By: @${input.actor} at ${input.at}
- Source: ${input.source}
- Reason: ${input.reason === null || input.reason.trim().length === 0 ? "`none given`" : input.reason.trim()}
- Applied: ${input.applied}`;

  return withMarker(body, "decision", input.issueNumber, input.runId);
}

export interface LimitInput {
  issueNumber: number;
  runId: string;
  consumedUsd: number;
  capUsd: number;
  turns: number;
  incrementUsd: number;
  cause: "cost" | "turns" | "wall-clock";
}

export function renderLimit(input: LimitInput): string {
  const causes: Record<LimitInput["cause"], string> = {
    cost: "the per-issue cost allowance",
    turns: "the maximum number of turns for one run",
    "wall-clock": "the maximum wall-clock time for one run",
  };
  const body = `Consumption limit reached.

Consumed \`${money(input.consumedUsd)}\` of an allowance of \`${money(input.capUsd)}\` (\`${input.turns}\` turns).
Stopped at the last boundary because ${causes[input.cause]} was reached.

To continue, a person with write access posts \`/agent continue\`. That raises this issue's allowance
by \`${money(input.incrementUsd)}\`. Nothing further happens until then.`;

  return withMarker(body, "limit", input.issueNumber, input.runId);
}

export type EndedBecause = "run finished" | "run halted" | "run failed" | "cache lost";

export interface LimitWarningInput {
  issueNumber: number;
  runId: string;
  consumedUsd: number;
  capUsd: number;
  warnAtRatio: number;
  turns: number;
}

/** Soft threshold notice. Posted once per run, before the hard stop. */
export function renderLimitWarning(input: LimitWarningInput): string {
  const threshold = Math.round(input.warnAtRatio * 100);
  const body = `Consumption warning.

Consumed \`${money(input.consumedUsd)}\` of an allowance of \`${money(input.capUsd)}\` (\`${input.turns}\` turns),
which is at or above the \`${threshold}%\` warning threshold. Work continues; the hard stop posts
\`/agent continue\` instructions when it is reached.`;
  return withMarker(body, "limit", input.issueNumber, `${input.runId}-warn`);
}

export interface InformationInput {
  issueNumber: number;
  runId: string;
  text: string;
}

/** Informational reply (status, help, unknown word). Never changes state. */
export function renderInformation(input: InformationInput): string {
  return withMarker(input.text, "notice", input.issueNumber, input.runId);
}

export interface SessionInput {
  issueNumber: number;
  sessionId: string;
  fingerprint: string;
  runIds: readonly string[];
  costUsd: number;
  tokens: number;
  turns: number;
  toolCalls: number;
  endedBecause: EndedBecause;
  issueTotalUsd: number;
  capUsd: number;
}

export function renderSession(input: SessionInput): string {
  const body = `Session ended.

- Session: \`${input.sessionId}\` (fingerprint \`${input.fingerprint}\`)
- Runs: ${input.runIds.map((runId) => `\`${runId}\``).join(", ")}
- Consumed: \`${money(input.costUsd)}\` (\`${input.tokens}\` tokens, \`${input.turns}\` turns, \`${input.toolCalls}\` tool calls)
- Ended because: ${input.endedBecause}
- Issue total: \`${money(input.issueTotalUsd)}\` of \`${money(input.capUsd)}\``;

  return withMarker(body, "session", input.issueNumber, input.sessionId);
}

export type NoticeKind = "directive" | "question" | "unmet" | "missing-report";

export interface NoticeInput {
  issueNumber: number;
  runId: string;
  kind: NoticeKind;
  items: readonly string[];
  question?: string;
}

export function renderNotice(input: NoticeInput): string {
  let body: string;
  switch (input.kind) {
    case "directive":
      body = `Directive check.\n\n${bullets(input.items, "Agent report: no embedded directive was found.")}`;
      break;
    case "question":
      body = `Question from the run.\n\n${input.question ?? ""}\n\nAnswer in this thread, then post \`/agent continue\`.`;
      break;
    case "unmet":
      body = `Standing instruction not honoured.\n\n${bullets(input.items, "none")}`;
      break;
    case "missing-report":
      body = "Directive check.\n\nNo directive report was produced for this run.";
      break;
  }
  return withMarker(body, "notice", input.issueNumber, input.runId);
}

export interface OutcomeInput {
  issueNumber: number;
  runId: string;
  pullRequestUrl: string;
  merged: boolean;
  actor: string;
  at: string;
  issueState: "finished" | "rejected";
}

export function renderOutcome(input: OutcomeInput): string {
  const result = input.merged
    ? `merged by @${input.actor} at ${input.at}`
    : `closed without merge by @${input.actor} at ${input.at}`;
  const body = `Proposal closed.

- Pull request: ${input.pullRequestUrl}
- Result: ${result}
- Issue state: \`${input.issueState}\``;
  return withMarker(body, "outcome", input.issueNumber, input.runId);
}

/** A redacted interpolation helper, so call sites cannot forget redaction. */
export function redactionNote(redacted: boolean): string | null {
  return redacted ? `A credential-shaped value was replaced by \`${REDACTION_PLACEHOLDER}\`.` : null;
}
