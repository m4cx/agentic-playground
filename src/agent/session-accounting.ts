/**
 * Per-session consumption accounting (contracts/pi-rpc.md §"Session accounting").
 *
 * `get_session_stats` values are session-lifetime values, and a session ends when
 * the configuration fingerprint changes or the cache is lost. The limit therefore
 * applies to the sum of the sessions documented on the issue, never to the current
 * session alone — a lost cache cannot reset it.
 */

import type { SessionStats } from "./pi-session.js";

export type EndedBecause = "finished" | "halted" | "failed" | "lost";

export interface SessionRecord {
  sessionId: string;
  fingerprint: string;
  runIds: string[];
  costUsd: number;
  tokens: number;
  turns: number;
  toolCalls: number;
  endedBecause: EndedBecause;
}

export interface ConsumptionTotal {
  costUsd: number;
  tokens: number;
  turns: number;
  toolCalls: number;
}

function emptyTotal(): ConsumptionTotal {
  return { costUsd: 0, tokens: 0, turns: 0, toolCalls: 0 };
}

/** One documented record per session per run: a session may span several runs. */
export function recordKey(record: Pick<SessionRecord, "sessionId" | "runIds">): string {
  return `${record.sessionId}#${record.runIds.join(",")}`;
}

export class SessionAccounting {
  private readonly sessionRecords: SessionRecord[] = [];

  constructor(records: readonly SessionRecord[] = []) {
    for (const record of records) this.sessionRecords.push({ ...record, runIds: [...record.runIds] });
  }

  get records(): readonly SessionRecord[] {
    return this.sessionRecords;
  }

  /**
   * Record a session exactly once. A duplicate id is a defect: the same session
   * must not be counted twice, and silently ignoring it would hide the defect.
   */
  record(record: SessionRecord): void {
    const key = recordKey(record);
    if (this.sessionRecords.some((existing) => recordKey(existing) === key)) {
      throw new Error(`session record ${key} is already documented`);
    }
    this.sessionRecords.push({ ...record, runIds: [...record.runIds] });
  }

  total(): ConsumptionTotal {
    const total = emptyTotal();
    for (const record of this.sessionRecords) {
      total.costUsd += record.costUsd;
      total.tokens += record.tokens;
      total.turns += record.turns;
      total.toolCalls += record.toolCalls;
    }
    return total;
  }

  get totalCostUsd(): number {
    return this.total().costUsd;
  }

  hasSession(sessionId: string): boolean {
    return this.sessionRecords.some((record) => record.sessionId === sessionId);
  }

  lastEndedBecause(sessionId: string): EndedBecause | null {
    const matches = this.sessionRecords.filter((record) => record.sessionId === sessionId);
    return matches.length === 0 ? null : (matches[matches.length - 1]?.endedBecause ?? null);
  }

  /** Stats of the session currently running, added to the documented baseline. */
  withCurrentSession(stats: SessionStats): ConsumptionTotal {
    const total = this.total();
    return {
      costUsd: total.costUsd + stats.costUsd,
      tokens: total.tokens + stats.tokens,
      turns: total.turns + stats.turns,
      toolCalls: total.toolCalls + stats.toolCalls,
    };
  }
}

const SESSION_LINE = /^- Session:\s*`?([^`\s]+)`?\s*\(fingerprint\s*`?([^`\s)]+)`?\)/;
const RUNS_LINE = /^- Runs:\s*(.+)$/;
const CONSUMED_LINE =
  /^- Consumed:\s*`?\$?([0-9]+(?:\.[0-9]+)?)`?\s*\(`?([0-9]+)`?\s*tokens,\s*`?([0-9]+)`?\s*turns,\s*`?([0-9]+)`?\s*tool calls\)/;
const ENDED_LINE = /^- Ended because:\s*(.+)$/;

/** Parse one `agent:session` comment body back into a record. */
export function parseSessionMessage(body: string): SessionRecord | null {
  const lines = body.split("\n").map((line) => line.trim());
  const sessionLine = lines.map((line) => SESSION_LINE.exec(line)).find((match) => match !== null);
  if (!sessionLine) return null;
  const sessionId = sessionLine[1];
  const fingerprint = sessionLine[2];
  if (sessionId === undefined || fingerprint === undefined) return null;

  const runsLine = lines.map((line) => RUNS_LINE.exec(line)).find((match) => match !== null);
  const runIds =
    runsLine?.[1] === undefined
      ? []
      : (runsLine[1].match(/`([^`]+)`/g) ?? []).map((token) => token.replaceAll("`", ""));

  const consumed = lines.map((line) => CONSUMED_LINE.exec(line)).find((match) => match !== null);
  const costUsd = consumed?.[1] === undefined ? 0 : Number.parseFloat(consumed[1]);
  const tokens = consumed?.[2] === undefined ? 0 : Number.parseInt(consumed[2], 10);
  const turns = consumed?.[3] === undefined ? 0 : Number.parseInt(consumed[3], 10);
  const toolCalls = consumed?.[4] === undefined ? 0 : Number.parseInt(consumed[4], 10);

  const endedLine = lines.map((line) => ENDED_LINE.exec(line)).find((match) => match !== null);
  const endedRaw = (endedLine?.[1] ?? "finished").toLowerCase();
  const endedBecause: EndedBecause =
    endedRaw.includes("halt")
      ? "halted"
      : endedRaw.includes("fail")
        ? "failed"
        : endedRaw.includes("lost")
          ? "lost"
          : "finished";

  return { sessionId, fingerprint, runIds, costUsd, tokens, turns, toolCalls, endedBecause };
}

/** Rebuild the issue's documented consumption from the thread's session messages. */
export function accountingFromMessages(bodies: readonly string[]): SessionAccounting {
  const records: SessionRecord[] = [];
  for (const body of bodies) {
    const record = parseSessionMessage(body);
    if (record !== null) records.push(record);
  }
  return new SessionAccounting(records);
}

/**
 * Whether a previously existing session disappeared. `lost` is reported only when
 * a session existed before and then vanished, never on a genuine first run.
 */
export function endedBecauseFor(
  hadDocumentedSessions: boolean,
  cachePresent: boolean,
  runEnd: "finished" | "halted" | "failed",
): EndedBecause {
  if (hadDocumentedSessions && !cachePresent) return "lost";
  return runEnd;
}
