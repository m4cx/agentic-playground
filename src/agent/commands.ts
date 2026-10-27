/**
 * Issue-thread command grammar (contracts/commands.md).
 *
 * A command is `/agent <word>` as the first non-whitespace token of a comment.
 * Matching the word is case-insensitive; the reason text is preserved verbatim and
 * redacted later. `/agent` mid-sentence, quoted, or inside a code fence is not a
 * command — that is what makes pasting a log harmless.
 */

export const DECISION_WORDS = ["halt", "retry", "continue", "approve", "reject"] as const;
export const INFORMATIONAL_WORDS = ["status", "help"] as const;
export const COMMAND_WORDS = [...DECISION_WORDS, ...INFORMATIONAL_WORDS] as const;

export type DecisionWord = (typeof DECISION_WORDS)[number];
export type InformationalWord = (typeof INFORMATIONAL_WORDS)[number];
export type CommandWord = (typeof COMMAND_WORDS)[number];
export type CommandKind = "decision" | "informational" | "unknown";

export interface ParsedCommand {
  /** Lower-case word as typed, or an empty string when no word followed. */
  word: string;
  kind: CommandKind;
  /** Verbatim reason text after the word, single line or block. */
  reason: string;
  /** Additional command words found later in the comment; ignored, listed in the reply. */
  extraWords: string[];
}

export function isDecisionWord(word: string): word is DecisionWord {
  return (DECISION_WORDS as readonly string[]).includes(word);
}

export function isInformationalWord(word: string): word is InformationalWord {
  return (INFORMATIONAL_WORDS as readonly string[]).includes(word);
}

const CODE_FENCE = /^\s*(```|~~~)/;

/**
 * Parse a comment body. Returns null when the comment is not a command at all.
 */
export function parseCommand(body: string | null | undefined): ParsedCommand | null {
  if (body === null || body === undefined) return null;
  const trimmed = body.replace(/^\uFEFF/, "").trimStart();
  if (trimmed.length === 0) return null;

  // A comment that starts with a code fence is never a command, even when the
  // fence contains `/agent halt`.
  if (CODE_FENCE.test(trimmed)) return null;

  const firstLine = trimmed.split("\n")[0] ?? "";
  const match = /^\/agent(?=\s|$)(.*)$/i.exec(firstLine);
  if (!match) return null;

  const rest = (match[1] ?? "").trim();
  const restTokens = rest.split(/\s+/).filter((token) => token.length > 0);
  const rawWord = restTokens[0] ?? "";
  const word = rawWord.toLowerCase();
  const reason = restTokens.slice(1).join(" ").trim();

  // Multi-line reasons: everything after the first line belongs to the reason,
  // unless it is another command, which is ignored and listed.
  const remainingLines = trimmed.split("\n").slice(1);
  const extraWords: string[] = [];
  const reasonLines: string[] = [];
  for (const line of remainingLines) {
    const extra = /^\s*\/agent\s+([A-Za-z]+)\b/i.exec(line);
    if (extra && extra[1] !== undefined) {
      extraWords.push(extra[1].toLowerCase());
      continue;
    }
    reasonLines.push(line);
  }

  const fullReason = [reason, ...reasonLines].join("\n").trim();
  const kind: CommandKind = isDecisionWord(word)
    ? "decision"
    : isInformationalWord(word)
      ? "informational"
      : "unknown";

  return { word, kind, reason: fullReason, extraWords };
}

/** The help text for an unknown word or `/agent help`. Fixed English. */
export function helpText(): string {
  return [
    "Agent commands",
    "",
    "- `/agent halt` — stop at the next action boundary",
    "- `/agent retry` — start a new run that continues the recorded state",
    "- `/agent continue` — resume work that is waiting for a decision",
    "- `/agent approve` — record approval of the proposal; it does not merge",
    "- `/agent reject <reason>` — record rejection of the proposal",
    "- `/agent status` — show the current state; changes nothing",
    "- `/agent help` — show this list",
    "",
    "A command must be the first word of the comment and the account needs write access.",
  ].join("\n");
}

/** The reply when an unknown word was posted. */
export function unknownCommandText(word: string): string {
  const named = word.length === 0 ? "`/agent` without a command word" : `\`/agent ${word}\``;
  return [`${named} is not a command; nothing changed.`, "", helpText()].join("\n");
}

/** The sentence appended when a comment contained more than one command. */
export function extraCommandsText(extraWords: readonly string[]): string {
  if (extraWords.length === 0) return "";
  const listed = extraWords.map((word) => `\`${word}\``).join(", ");
  return `Only the first command in the comment was applied. Ignored: ${listed}.`;
}
