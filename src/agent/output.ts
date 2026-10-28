import { AgentError } from "./errors.js";
import { redactRequired } from "./redact.js";

export type AgentOutputState = "finished" | "waiting";

export interface AgentOutput {
  summary: string;
  verification: string[];
  openQuestions: string[];
  couldNotComplete: string[];
  prTitle: string;
  prBody: string;
  state: AgentOutputState;
}

const OUTPUT_KEYS = new Set([
  "summary",
  "verification",
  "openQuestions",
  "couldNotComplete",
  "prTitle",
  "prBody",
  "state",
]);

const NON_ENGLISH_WORDS = new Set([
  "der",
  "die",
  "das",
  "und",
  "ist",
  "nicht",
  "ein",
  "eine",
  "mit",
  "für",
  "auf",
  "werden",
  "wird",
  "sind",
  "les",
  "des",
  "une",
  "est",
  "pas",
  "dans",
  "pour",
  "avec",
  "sur",
  "los",
  "las",
  "una",
  "es",
  "por",
  "para",
  "con",
  "que",
  "não",
  "uma",
  "com",
  "para",
  "è",
  "sono",
  "della",
  "che",
]);

function fail(message: string): never {
  throw new AgentError("agent-output", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function englishString(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== "string") {
    fail(`${field} must be a string`);
  }
  const text = value.trim();
  if (text.length < min || text.length > max) {
    fail(`${field} must be ${min}..${max} characters`);
  }
  if (/[^\p{Script=Latin}\p{Number}\p{Punctuation}\p{Separator}\p{Symbol}]/u.test(text)) {
    fail(`${field} must be written in English`);
  }
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const nonEnglish = words.filter((word) => NON_ENGLISH_WORDS.has(word)).length;
  if (words.length > 0 && nonEnglish >= 3 && nonEnglish / words.length >= 0.2) {
    fail(`${field} must be written in English`);
  }
  return text;
}

function englishList(value: unknown, field: string, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) {
    fail(`${field} must be an array`);
  }
  if (value.length > maxItems) {
    fail(`${field} must contain at most ${maxItems} items`);
  }
  return value.map((item, index) => englishString(item, `${field}[${index}]`, 1, maxLength));
}

export function extractLastJsonBlock(text: string): string {
  const pattern = /```json[ \t]*\r?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let last: string | null = null;
  while ((match = pattern.exec(text)) !== null) {
    last = match[1] ?? null;
  }
  if (last === null) {
    fail("final message has no fenced json block");
  }
  return last.trim();
}

export function validateAgentOutput(raw: unknown, secrets: readonly string[] = []): AgentOutput {
  if (!isRecord(raw)) {
    fail("output must be a JSON object");
  }
  for (const key of Object.keys(raw)) {
    if (!OUTPUT_KEYS.has(key)) {
      fail(`unknown output key "${key}"`);
    }
  }

  const summary = redactRequired(englishString(raw.summary, "summary", 1, 4000), "summary", secrets);
  const verification = englishList(raw.verification, "verification", 20, 500).map((item) =>
    redactRequired(item, "verification", secrets),
  );
  const openQuestions = englishList(raw.openQuestions, "openQuestions", 10, 1000).map((item) =>
    redactRequired(item, "openQuestions", secrets),
  );
  const couldNotComplete = englishList(raw.couldNotComplete, "couldNotComplete", 20, 1000).map((item) =>
    redactRequired(item, "couldNotComplete", secrets),
  );
  // The pull-request title and body are presentation fields. If the model ignores the
  // English rule for them, the orchestrator uses its own English template instead of
  // failing the whole run. The summary and the other durable fields stay strict.
  let prTitle = "";
  try {
    prTitle = redactRequired(englishString(raw.prTitle, "prTitle", 1, 120), "prTitle", secrets);
  } catch {
    prTitle = "";
  }
  let prBody = "";
  try {
    prBody = redactRequired(englishString(raw.prBody, "prBody", 1, 8000), "prBody", secrets);
  } catch {
    prBody = "";
  }

  if (raw.state !== "finished" && raw.state !== "waiting") {
    fail('state must be "finished" or "waiting"');
  }
  if (raw.state === "waiting" && openQuestions.length === 0) {
    fail("state waiting requires at least one open question");
  }
  if (prBody.length > 0 && /\b(merged|merge it|i merged)\b/i.test(prBody)) {
    fail("prBody must not claim a merge");
  }

  return {
    summary,
    verification,
    openQuestions,
    couldNotComplete,
    prTitle,
    prBody,
    state: raw.state,
  };
}

export function parseAgentOutput(text: string, secrets: readonly string[] = []): AgentOutput {
  const block = extractLastJsonBlock(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(block) as unknown;
  } catch {
    fail("fenced json block is not valid JSON");
  }
  return validateAgentOutput(parsed, secrets);
}
