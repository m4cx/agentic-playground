import { AgentError } from "./errors.js";
import { deriveSlug, isValidSlug } from "./slug.js";

export const SESSION_STATES = [
  "accepted",
  "working",
  "waiting",
  "finished",
  "failed",
  "stopped",
] as const;

export type SessionState = (typeof SESSION_STATES)[number];

export const ACTIVE_STATES: readonly SessionState[] = ["accepted", "working"];

export type PermissionLevel = "admin" | "maintain" | "write";

export interface Trigger {
  kind: "label" | "resume-command";
  actor: string;
  permission: PermissionLevel;
  at: string;
  commentId: number | null;
  commandText: string | null;
  labelName: string | null;
}

export interface RunSummary {
  id: string;
  trigger: Trigger;
  startedAt: string;
  endedAt: string | null;
  outcome: "finished" | "waiting" | "failed" | "stopped" | null;
  piSessionId: string;
  commitShas: string[];
  changedPaths: string[];
  verification: string[];
  failureReason: string | null;
  nextAction: string | null;
}

export interface LastFailure {
  reason: string;
  nextAction: string;
}

export interface AgentSession {
  id: string;
  piSessionId: string;
  fingerprint: string;
  issueNumber: number;
  slug: string;
  branchName: string;
  state: SessionState;
  requestVersion: string;
  baseSha: string | null;
  headSha: string | null;
  pullRequestNumber: number | null;
  createdAt: string;
  updatedAt: string;
  lastTrigger: Trigger;
  runs: RunSummary[];
  lastFailure: LastFailure | null;
}

export interface StateRecord {
  schema: 1;
  session: AgentSession;
  lastRun: RunSummary | null;
  sessionCommentId: number | null;
  updatedByRun: string;
}

const TRANSITIONS: Record<SessionState, readonly SessionState[]> = {
  accepted: ["working", "stopped", "failed"],
  working: ["waiting", "finished", "failed", "stopped"],
  waiting: ["working", "stopped"],
  finished: ["working"],
  failed: ["working", "stopped"],
  stopped: ["working"],
};

export function isSessionState(value: unknown): value is SessionState {
  return typeof value === "string" && SESSION_STATES.includes(value as SessionState);
}

export function isActiveState(state: SessionState): boolean {
  return ACTIVE_STATES.includes(state);
}

export function canTransition(from: SessionState, to: SessionState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: SessionState, to: SessionState): void {
  if (!canTransition(from, to)) {
    throw new AgentError("state-transition", `invalid session transition ${from} -> ${to}`);
  }
}

export function branchNameFor(issueNumber: number, slug: string): string {
  return `feature/${issueNumber}-${slug}`;
}

export function piSessionIdFor(issueNumber: number, fingerprint: string): string {
  return `issue-${issueNumber}-${fingerprint}`;
}

export function issueNumberFromBranch(branch: string): number | null {
  const match = /^feature\/(\d+)-/.exec(branch);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function isBotActor(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as { type?: unknown; login?: unknown };
  return record.type === "Bot" || String(record.login ?? "").endsWith("[bot]");
}

export interface CreateSessionInput {
  issueNumber: number;
  title: string;
  trigger: Trigger;
  now: string;
  slugMaxLength: number;
  fingerprint: string;
  requestVersion: string;
}

export function createSession(input: CreateSessionInput): AgentSession {
  const slug = deriveSlug(input.title, input.slugMaxLength);
  return {
    id: `issue-${input.issueNumber}`,
    piSessionId: piSessionIdFor(input.issueNumber, input.fingerprint),
    fingerprint: input.fingerprint,
    issueNumber: input.issueNumber,
    slug,
    branchName: branchNameFor(input.issueNumber, slug),
    state: "accepted",
    requestVersion: input.requestVersion,
    baseSha: null,
    headSha: null,
    pullRequestNumber: null,
    createdAt: input.now,
    updatedAt: input.now,
    lastTrigger: input.trigger,
    runs: [],
    lastFailure: null,
  };
}

export function createStateRecord(
  session: AgentSession,
  runId: string,
  sessionCommentId: number | null = null,
): StateRecord {
  return {
    schema: 1,
    session,
    lastRun: null,
    sessionCommentId,
    updatedByRun: runId,
  };
}

export function renderStateMarker(record: StateRecord): string {
  return `<!-- agent-session-state ${JSON.stringify(record)} -->`;
}

const MARKER_PATTERN = /<!--\s*agent-session-state\s+(\{[\s\S]*?\})\s*-->/;

export function parseStateMarker(body: string): StateRecord | null {
  const match = MARKER_PATTERN.exec(body);
  if (!match) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(match[1] ?? "") as unknown;
  } catch {
    throw new AgentError("state-recovery", "session state marker is not valid JSON");
  }
  return validateStateRecord(raw);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new AgentError("state-recovery", `${field} must be an object`);
  }
  return value;
}

function requireString(value: unknown, field: string, min = 1, max = 10000): string {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    throw new AgentError("state-recovery", `${field} must be a string of ${min}..${max} characters`);
  }
  return value;
}

function requireInteger(value: unknown, field: string, min = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) {
    throw new AgentError("state-recovery", `${field} must be an integer >= ${min}`);
  }
  return value;
}

function requireNullableString(value: unknown, field: string, max = 1000): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || value.length > max) {
    throw new AgentError("state-recovery", `${field} must be a string or null`);
  }
  return value;
}

function requireNullableInteger(value: unknown, field: string): number | null {
  if (value === null) {
    return null;
  }
  return requireInteger(value, field);
}

function validateTrigger(value: unknown): Trigger {
  const trigger = requireRecord(value, "session.lastTrigger");
  if (trigger.kind !== "label" && trigger.kind !== "resume-command") {
    throw new AgentError("state-recovery", "lastTrigger.kind is invalid");
  }
  if (
    trigger.permission !== "admin" &&
    trigger.permission !== "maintain" &&
    trigger.permission !== "write"
  ) {
    throw new AgentError("state-recovery", "lastTrigger.permission is invalid");
  }
  return {
    kind: trigger.kind,
    actor: requireString(trigger.actor, "lastTrigger.actor", 1, 200),
    permission: trigger.permission,
    at: requireString(trigger.at, "lastTrigger.at", 1, 100),
    commentId: requireNullableInteger(trigger.commentId, "lastTrigger.commentId"),
    commandText: requireNullableString(trigger.commandText, "lastTrigger.commandText", 20000),
    labelName: requireNullableString(trigger.labelName, "lastTrigger.labelName", 200),
  };
}

function validateRun(value: unknown): RunSummary {
  const run = requireRecord(value, "run");
  const outcome = run.outcome;
  if (
    outcome !== null &&
    outcome !== "finished" &&
    outcome !== "waiting" &&
    outcome !== "failed" &&
    outcome !== "stopped"
  ) {
    throw new AgentError("state-recovery", "run.outcome is invalid");
  }
  return {
    id: requireString(run.id, "run.id", 1, 200),
    trigger: validateTrigger(run.trigger),
    startedAt: requireString(run.startedAt, "run.startedAt", 1, 100),
    endedAt: requireNullableString(run.endedAt, "run.endedAt", 100),
    outcome,
    piSessionId: requireString(run.piSessionId, "run.piSessionId", 1, 200),
    commitShas: Array.isArray(run.commitShas)
      ? run.commitShas.map((sha, index) => requireString(sha, `run.commitShas[${index}]`, 1, 100))
      : [],
    changedPaths: Array.isArray(run.changedPaths)
      ? run.changedPaths.map((entry, index) =>
          requireString(entry, `run.changedPaths[${index}]`, 1, 500),
        )
      : [],
    verification: Array.isArray(run.verification)
      ? run.verification.map((entry, index) =>
          requireString(entry, `run.verification[${index}]`, 1, 1000),
        )
      : [],
    failureReason: requireNullableString(run.failureReason, "run.failureReason", 500),
    nextAction: requireNullableString(run.nextAction, "run.nextAction", 2000),
  };
}

export function validateSession(value: unknown, expectedIssueNumber?: number): AgentSession {
  const session = requireRecord(value, "session");
  const issueNumber = requireInteger(session.issueNumber, "session.issueNumber", 1);
  if (expectedIssueNumber !== undefined && issueNumber !== expectedIssueNumber) {
    throw new AgentError("state-recovery", "session issue number does not match the event issue");
  }
  const slug = requireString(session.slug, "session.slug", 1, 50);
  if (!isValidSlug(slug, 50)) {
    throw new AgentError("state-recovery", "session.slug is invalid");
  }
  const branchName = requireString(session.branchName, "session.branchName", 1, 300);
  if (branchName !== branchNameFor(issueNumber, slug)) {
    throw new AgentError("state-recovery", "session.branchName does not match issue and slug");
  }
  if (!isSessionState(session.state)) {
    throw new AgentError("state-recovery", "session.state is invalid");
  }

  const runs = Array.isArray(session.runs) ? session.runs.slice(-50).map(validateRun) : [];
  let lastFailure: LastFailure | null = null;
  if (session.lastFailure !== null) {
    const failure = requireRecord(session.lastFailure, "session.lastFailure");
    lastFailure = {
      reason: requireString(failure.reason, "lastFailure.reason", 1, 500),
      nextAction: requireString(failure.nextAction, "lastFailure.nextAction", 1, 2000),
    };
  }

  return {
    id: requireString(session.id, "session.id", 1, 200),
    piSessionId: requireString(session.piSessionId, "session.piSessionId", 1, 200),
    fingerprint: requireString(session.fingerprint, "session.fingerprint", 1, 100),
    issueNumber,
    slug,
    branchName,
    state: session.state,
    requestVersion: requireString(session.requestVersion, "session.requestVersion", 1, 200),
    baseSha: requireNullableString(session.baseSha, "session.baseSha", 100),
    headSha: requireNullableString(session.headSha, "session.headSha", 100),
    pullRequestNumber: requireNullableInteger(session.pullRequestNumber, "session.pullRequestNumber"),
    createdAt: requireString(session.createdAt, "session.createdAt", 1, 100),
    updatedAt: requireString(session.updatedAt, "session.updatedAt", 1, 100),
    lastTrigger: validateTrigger(session.lastTrigger),
    runs,
    lastFailure,
  };
}

export function validateStateRecord(value: unknown, expectedIssueNumber?: number): StateRecord {
  const record = requireRecord(value, "state record");
  if (record.schema !== 1) {
    throw new AgentError("state-recovery", "state schema must be exactly 1");
  }
  const session = validateSession(record.session, expectedIssueNumber);
  const lastRun = record.lastRun === null ? null : validateRun(record.lastRun);
  return {
    schema: 1,
    session,
    lastRun,
    sessionCommentId: requireNullableInteger(record.sessionCommentId, "sessionCommentId"),
    updatedByRun: requireString(record.updatedByRun, "updatedByRun", 1, 200),
  };
}

export function cloneStateRecord(record: StateRecord): StateRecord {
  return JSON.parse(JSON.stringify(record)) as StateRecord;
}
