/**
 * Parse the three agent report blocks and render them as `agent:notice` payloads
 * (contracts/thread-messages.md §9, FR-006, FR-014, FR-030).
 *
 * The blocks are data, never instructions. A missing `agent-ignored:` block is
 * recorded as missing, because that is what makes SC-014 auditable; a missing
 * `agent-question:` or `agent-unmet:` block is "none".
 */

import type { NoticeInput, NoticeKind } from "./messages.js";

export type BlockState = "none" | "list" | "missing" | "unparsable";

export interface DirectiveReport {
  ignored: { state: BlockState; items: string[] };
  question: { state: BlockState; text: string | null };
  unmet: { state: BlockState; items: string[] };
}

const IGNORED_HEADER = /^agent-ignored:\s*(.*)$/i;
const QUESTION_HEADER = /^agent-question:\s*(.*)$/i;
const UNMET_HEADER = /^agent-unmet:\s*(.*)$/i;
const BULLET = /^\s*[-*]\s+(.*)$/;

function parseBlock(
  lines: readonly string[],
  header: RegExp,
): { state: BlockState; inline: string; items: string[] } {
  const index = lines.findIndex((line) => header.test(line));
  if (index < 0) return { state: "missing", inline: "", items: [] };
  const line = lines[index] ?? "";
  const match = header.exec(line);
  const inline = (match?.[1] ?? "").trim();
  const items: string[] = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const candidate = lines[cursor] ?? "";
    if (candidate.trim().length === 0) {
      if (items.length > 0) break;
      continue;
    }
    if (/^agent-(ignored|question|unmet):/i.test(candidate.trim())) break;
    const bullet = BULLET.exec(candidate);
    if (bullet?.[1] !== undefined) {
      items.push(bullet[1].trim());
      continue;
    }
    break;
  }

  if (inline.length > 0) {
    if (/^none\b/i.test(inline)) return { state: "none", inline, items: [] };
    // `agent-ignored: <one line>` is a usable single item; a question is inline text.
    return { state: "list", inline, items: [inline] };
  }
  if (items.length > 0) return { state: "list", inline, items };
  return { state: "unparsable", inline, items: [] };
}

/** Parse the report blocks out of the agent's final answer. */
export function parseDirectiveReport(answer: string): DirectiveReport {
  const lines = answer.split("\n").map((line) => line.replace(/\r$/, ""));
  const ignored = parseBlock(lines, IGNORED_HEADER);
  const unmet = parseBlock(lines, UNMET_HEADER);

  const questionIndex = lines.findIndex((line) => QUESTION_HEADER.test(line));
  let question: DirectiveReport["question"];
  if (questionIndex < 0) {
    question = { state: "missing", text: null };
  } else {
    const inline = (QUESTION_HEADER.exec(lines[questionIndex] ?? "")?.[1] ?? "").trim();
    if (inline.length > 0 && !/^none\b/i.test(inline)) {
      question = { state: "list", text: inline };
    } else if (inline.length > 0) {
      question = { state: "none", text: null };
    } else {
      // A question on the following lines is accepted as a single question.
      const following: string[] = [];
      for (let cursor = questionIndex + 1; cursor < lines.length; cursor += 1) {
        const candidate = (lines[cursor] ?? "").trim();
        if (candidate.length === 0) {
          if (following.length > 0) break;
          continue;
        }
        if (/^agent-[a-z]+:/i.test(candidate)) break;
        following.push(candidate);
      }
      question =
        following.length === 0
          ? { state: "unparsable", text: null }
          : { state: "list", text: following.join(" ") };
    }
  }

  return {
    ignored: { state: ignored.state, items: ignored.items },
    question,
    unmet: { state: unmet.state, items: unmet.items },
  };
}

export interface NoticePlanEntry {
  kind: NoticeKind;
  items: string[];
  question?: string;
}

export interface NoticePlan {
  notices: NoticePlanEntry[];
  /** Note appended to the state log, or null when nothing needs recording. */
  stateLogNote: string | null;
  /** True when the mandatory `agent-ignored:` block was absent or unparsable. */
  reportMissing: boolean;
}

/**
 * Turn a report into the notices that must be posted. `directive` is always
 * produced: either the list of ignored items, the explicit "none" statement, or
 * the explicit "no report was produced" statement.
 */
export function planNotices(report: DirectiveReport): NoticePlan {
  const notices: NoticePlanEntry[] = [];
  let stateLogNote: string | null = null;
  let reportMissing = false;

  if (report.ignored.state === "list") {
    notices.push({ kind: "directive", items: report.ignored.items });
  } else if (report.ignored.state === "none") {
    notices.push({
      kind: "directive",
      items: ["No embedded directive was found in the issue thread."],
    });
  } else {
    reportMissing = true;
    notices.push({ kind: "missing-report", items: [] });
    stateLogNote =
      report.ignored.state === "unparsable"
        ? "The agent's directive report could not be parsed; recorded as missing (FR-030)."
        : "No directive report was produced for this run; recorded as missing (FR-030).";
  }

  if (report.question.state === "list" && report.question.text !== null) {
    notices.push({ kind: "question", items: [], question: report.question.text });
    stateLogNote = stateLogNote ?? "The run asked a question and is waiting for an answer.";
  } else if (report.question.state === "unparsable") {
    stateLogNote = stateLogNote ?? "The agent's question block could not be parsed; nothing was asked.";
  }

  if (report.unmet.state === "list") {
    notices.push({ kind: "unmet", items: report.unmet.items });
  }

  return { notices, stateLogNote, reportMissing };
}

/** Build `agent:notice` inputs for a plan. */
export function noticeInputs(
  plan: NoticePlan,
  context: { issueNumber: number; runId: string },
): NoticeInput[] {
  return plan.notices.map((entry) => ({
    issueNumber: context.issueNumber,
    runId: context.runId,
    kind: entry.kind,
    items: entry.items,
    ...(entry.question === undefined ? {} : { question: entry.question }),
  }));
}

/** True when the run must pause for a human answer. */
export function requiresHumanAnswer(report: DirectiveReport): boolean {
  return report.question.state === "list" && report.question.text !== null;
}
