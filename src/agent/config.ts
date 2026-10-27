/**
 * Load, validate, and fingerprint `.agent/config.yml` (contracts/config.md).
 *
 * The configuration is the single behaviour surface. Validation is fail-closed:
 * an unknown key, a missing key, or an out-of-range value raises a ConfigError
 * naming the offending key, and the run fails with `environment` before any model
 * call. There is no silent fallback to a default.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, normalize, resolve } from "node:path";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** Built-in tool names the orchestrator is willing to hand to the agent. */
export const KNOWN_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;

/** A tool name matching this is refused even if someone adds it to KNOWN_TOOLS later. */
const FORBIDDEN_TOOL_PATTERN = /(^|[_-])(git|github|gh|forge|merge|push|deploy)([_-]|$)/i;

export interface LabelConfig {
  request: string;
  queued: string;
  working: string;
  waiting: string;
  halted: string;
  finished: string;
  failed: string;
  rejected: string;
  proposal: string;
}

export interface LimitConfig {
  maxCostUsd: number;
  warnAtRatio: number;
  continueIncrementUsd: number;
  maxTurns: number;
  maxWallClockMinutes: number;
  startDeadlineSeconds: number;
}

export interface ProposalConfig {
  maxChangedPaths: number;
  maxDiffLines: number;
}

export interface ContinuityConfig {
  sessionCacheKeyPrefix: string;
}

export interface NetworkConfig {
  allowHosts: string[];
}

export interface SweepConfig {
  graceMinutes: number;
}

export interface AgentConfig {
  model: string;
  thinking: ThinkingLevel;
  tools: string[];
  promptTemplates: string[];
  instructionsPath: string;
  labels: LabelConfig;
  globalHaltIssue: number;
  limits: LimitConfig;
  proposal: ProposalConfig;
  continuity: ContinuityConfig;
  network: NetworkConfig;
  sweep: SweepConfig;
}

export interface LoadedConfig {
  config: AgentConfig;
  instructions: string;
  instructionsHash: string;
  fingerprint: string;
  configPath: string;
}

export class ConfigError extends Error {
  readonly key: string | null;

  constructor(message: string, key: string | null = null) {
    super(message);
    this.name = "ConfigError";
    this.key = key;
  }
}

// ---------------------------------------------------------------------------
// Minimal YAML subset parser
// ---------------------------------------------------------------------------

type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue };

interface YamlLine {
  indent: number;
  text: string;
  number: number;
}

function stripComment(raw: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "'" && !inDouble) inSingle = !inSingle;
    else if (char === '"' && !inSingle) {
      const escaped = raw[index - 1] === "\\";
      if (!escaped) inDouble = !inDouble;
    } else if (char === "#" && !inSingle && !inDouble) {
      // A comment marker only starts a comment at the beginning of a line or after whitespace.
      const previous = index === 0 ? " " : raw[index - 1];
      if (previous === undefined || /\s/.test(previous)) return raw.slice(0, index);
    }
  }
  return raw;
}

function toYamlLines(source: string): YamlLine[] {
  const lines: YamlLine[] = [];
  source.split("\n").forEach((rawLine, index) => {
    const withoutComment = stripComment(rawLine);
    if (withoutComment.trim().length === 0) return;
    if (withoutComment.includes("\t")) {
      throw new ConfigError(`tab indentation is not allowed (line ${index + 1})`);
    }
    const indent = withoutComment.length - withoutComment.trimStart().length;
    lines.push({ indent, text: withoutComment.trim(), number: index + 1 });
  });
  return lines;
}

function parseScalar(raw: string, lineNumber: number): YamlValue {
  const value = raw.trim();
  if (value.length === 0) return null;
  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length === 1) {
      throw new ConfigError(`unterminated double-quoted value (line ${lineNumber})`);
    }
    try {
      return JSON.parse(value) as string;
    } catch {
      throw new ConfigError(`invalid double-quoted value (line ${lineNumber})`);
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length === 1) {
      throw new ConfigError(`unterminated single-quoted value (line ${lineNumber})`);
    }
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value === "[]") return [];
  if (value === "{}") return {};
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return inner.split(",").map((part) => parseScalar(part, lineNumber));
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^-?\d*\.\d+$/.test(value)) return Number.parseFloat(value);
  return value;
}

function splitKeyValue(text: string, lineNumber: number): { key: string; rest: string } {
  const colon = text.indexOf(":");
  if (colon <= 0) throw new ConfigError(`expected "key: value" (line ${lineNumber})`);
  const key = text.slice(0, colon).trim();
  if (key.length === 0) throw new ConfigError(`empty key (line ${lineNumber})`);
  if (/\s/.test(key)) throw new ConfigError(`key contains whitespace: ${key} (line ${lineNumber})`);
  return { key, rest: text.slice(colon + 1).trim() };
}

function parseBlock(lines: YamlLine[], start: number, indent: number): { value: YamlValue; next: number } {
  const first = lines[start];
  if (first === undefined) throw new ConfigError("unexpected end of document");
  if (first.indent !== indent) {
    throw new ConfigError(`unexpected indentation (line ${first.number})`);
  }
  if (first.text.startsWith("- ") || first.text === "-") {
    return parseSequence(lines, start, indent);
  }
  return parseMapping(lines, start, indent);
}

function parseSequence(lines: YamlLine[], start: number, indent: number): { value: YamlValue[]; next: number } {
  const result: YamlValue[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined) break;
    if (line.indent < indent) break;
    if (line.indent > indent) throw new ConfigError(`unexpected indentation (line ${line.number})`);
    if (!line.text.startsWith("-")) break;
    const itemText = line.text.slice(1).trim();
    if (itemText.length === 0) {
      const nested = lines[index + 1];
      if (nested === undefined || nested.indent <= indent) {
        result.push(null);
        index += 1;
        continue;
      }
      const parsed = parseBlock(lines, index + 1, nested.indent);
      result.push(parsed.value);
      index = parsed.next;
      continue;
    }
    if (itemText.includes(": ") || itemText.endsWith(":")) {
      throw new ConfigError(
        `nested mappings inside a sequence are not supported (line ${line.number}); use a mapping key`,
      );
    }
    result.push(parseScalar(itemText, line.number));
    index += 1;
  }
  return { value: result, next: index };
}

function parseMapping(
  lines: YamlLine[],
  start: number,
  indent: number,
): { value: { [key: string]: YamlValue }; next: number } {
  const result: { [key: string]: YamlValue } = {};
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined) break;
    if (line.indent < indent) break;
    if (line.indent > indent) throw new ConfigError(`unexpected indentation (line ${line.number})`);
    if (line.text.startsWith("-")) break;
    const { key, rest } = splitKeyValue(line.text, line.number);
    if (Object.hasOwn(result, key)) throw new ConfigError(`duplicate key: ${key} (line ${line.number})`);
    if (rest.length > 0) {
      result[key] = parseScalar(rest, line.number);
      index += 1;
      continue;
    }
    const nested = lines[index + 1];
    if (nested === undefined || nested.indent <= indent) {
      result[key] = null;
      index += 1;
      continue;
    }
    const parsed = parseBlock(lines, index + 1, nested.indent);
    result[key] = parsed.value;
    index = parsed.next;
  }
  return { value: result, next: index };
}

/** Parse the YAML subset used by `.agent/config.yml`. Exposed for tests. */
export function parseConfigYaml(source: string): YamlValue {
  const lines = toYamlLines(source);
  if (lines.length === 0) throw new ConfigError("configuration file is empty");
  const parsed = parseBlock(lines, 0, lines[0]?.indent ?? 0);
  if (parsed.next !== lines.length) {
    const trailing = lines[parsed.next];
    throw new ConfigError(`unexpected trailing content (line ${trailing?.number ?? "?"})`);
  }
  return parsed.value;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidateOptions {
  repoRoot?: string;
  fileExists?: (relativePath: string) => boolean;
  instructionsContent?: string;
}

const TOP_LEVEL_KEYS = [
  "model",
  "thinking",
  "tools",
  "promptTemplates",
  "instructionsPath",
  "labels",
  "globalHaltIssue",
  "limits",
  "proposal",
  "continuity",
  "network",
  "sweep",
] as const;

const LABEL_KEYS = [
  "request",
  "queued",
  "working",
  "waiting",
  "halted",
  "finished",
  "failed",
  "rejected",
  "proposal",
] as const;

const LIMIT_KEYS = [
  "maxCostUsd",
  "warnAtRatio",
  "continueIncrementUsd",
  "maxTurns",
  "maxWallClockMinutes",
  "startDeadlineSeconds",
] as const;

const PROPOSAL_KEYS = ["maxChangedPaths", "maxDiffLines"] as const;

function fail(message: string, key: string | null = null): never {
  throw new ConfigError(message, key);
}

function expectMapping(value: YamlValue | undefined, key: string): { [key: string]: YamlValue } {
  if (value === undefined || value === null) fail(`missing required key: ${key}`, key);
  if (typeof value !== "object" || Array.isArray(value)) fail(`expected a mapping for ${key}`, key);
  return value as { [key: string]: YamlValue };
}

function rejectUnknownKeys(mapping: { [key: string]: YamlValue }, allowed: readonly string[], prefix: string): void {
  for (const key of Object.keys(mapping)) {
    if (!allowed.includes(key)) {
      const name = prefix.length > 0 ? `${prefix}.${key}` : key;
      fail(`unknown configuration key: ${name}`, name);
    }
  }
}

function expectString(value: YamlValue | undefined, key: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`expected a non-empty string for ${key}`, key);
  }
  return value;
}

function expectStringList(value: YamlValue | undefined, key: string): string[] {
  if (!Array.isArray(value)) fail(`expected a list for ${key}`, key);
  return value.map((entry, index) => {
    if (typeof entry !== "string") fail(`expected a string at ${key}[${index}]`, `${key}[${index}]`);
    return entry;
  });
}

function expectNumber(value: YamlValue | undefined, key: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`expected a number for ${key}`, key);
  }
  return value;
}

function expectPositiveNumber(value: YamlValue | undefined, key: string): number {
  const number = expectNumber(value, key);
  if (number <= 0) fail(`${key} must be greater than 0`, key);
  return number;
}

function expectPositiveInteger(value: YamlValue | undefined, key: string): number {
  const number = expectNumber(value, key);
  if (!Number.isInteger(number) || number <= 0) fail(`${key} must be a positive integer`, key);
  return number;
}

function isRepositoryRelative(path: string): boolean {
  if (isAbsolute(path)) return false;
  const normalised = normalize(path);
  return !normalised.startsWith("..") && !normalised.includes("/../");
}

function validateHost(host: string): void {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host)) {
    fail(`network.allowHosts contains an invalid host name: ${host}`, "network.allowHosts");
  }
}

export function computeFingerprint(parts: {
  instructions: string;
  model: string;
  thinking: string;
  tools: readonly string[];
  promptTemplates: readonly string[];
}): string {
  const payload = JSON.stringify({
    instructions: sha256(parts.instructions),
    model: parts.model,
    thinking: parts.thinking,
    tools: [...parts.tools],
    promptTemplates: [...parts.promptTemplates],
  });
  return sha256(payload);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function shortHash(value: string, length = 12): string {
  return value.slice(0, length);
}

export function validateConfig(raw: YamlValue, options: ValidateOptions = {}): {
  config: AgentConfig;
  instructionsHash: string;
  fingerprint: string;
} {
  const root = expectMapping(raw, "configuration");
  rejectUnknownKeys(root, TOP_LEVEL_KEYS, "");

  const model = expectString(root["model"], "model");

  const thinkingRaw = expectString(root["thinking"], "thinking");
  if (!(THINKING_LEVELS as readonly string[]).includes(thinkingRaw)) {
    fail(`thinking must be one of ${THINKING_LEVELS.join(", ")}`, "thinking");
  }
  const thinking = thinkingRaw as ThinkingLevel;

  const tools = expectStringList(root["tools"], "tools");
  for (const tool of tools) {
    if (!(KNOWN_TOOLS as readonly string[]).includes(tool)) {
      fail(`tools contains an unknown tool: ${tool}`, "tools");
    }
    if (FORBIDDEN_TOOL_PATTERN.test(tool)) {
      fail(`tools must never contain a git or forge tool: ${tool}`, "tools");
    }
  }

  const fileExists = options.fileExists ?? (() => true);
  const promptTemplates = expectStringList(root["promptTemplates"], "promptTemplates");
  for (const templatePath of promptTemplates) {
    if (!templatePath.endsWith(".md")) {
      fail(`promptTemplates entries must end in .md: ${templatePath}`, "promptTemplates");
    }
    if (!isRepositoryRelative(templatePath)) {
      fail(`promptTemplates entry is not repository-relative: ${templatePath}`, "promptTemplates");
    }
    if (!fileExists(templatePath)) {
      fail(`promptTemplates entry does not exist on the trusted ref: ${templatePath}`, "promptTemplates");
    }
  }

  const instructionsPath = expectString(root["instructionsPath"], "instructionsPath");
  if (!isRepositoryRelative(instructionsPath)) {
    fail(`instructionsPath is not repository-relative: ${instructionsPath}`, "instructionsPath");
  }
  if (!instructionsPath.endsWith(".md")) {
    fail(`instructionsPath must end in .md: ${instructionsPath}`, "instructionsPath");
  }
  if (!fileExists(instructionsPath)) {
    fail(`instructionsPath does not exist on the trusted ref: ${instructionsPath}`, "instructionsPath");
  }

  const labelMapping = expectMapping(root["labels"], "labels");
  rejectUnknownKeys(labelMapping, LABEL_KEYS, "labels");
  const labels = {} as LabelConfig;
  for (const key of LABEL_KEYS) {
    labels[key] = expectString(labelMapping[key], `labels.${key}`);
  }
  const stateLabels = [
    labels.queued,
    labels.working,
    labels.waiting,
    labels.halted,
    labels.finished,
    labels.failed,
    labels.rejected,
  ];
  if (stateLabels.includes(labels.request)) {
    fail("labels.request must not collide with a state label", "labels.request");
  }
  if (new Set(stateLabels).size !== stateLabels.length) {
    fail("labels must map every state to a distinct label", "labels");
  }

  const globalHaltIssue = expectPositiveInteger(root["globalHaltIssue"], "globalHaltIssue");

  const limitMapping = expectMapping(root["limits"], "limits");
  rejectUnknownKeys(limitMapping, LIMIT_KEYS, "limits");
  const warnAtRatio = expectNumber(limitMapping["warnAtRatio"], "limits.warnAtRatio");
  if (!(warnAtRatio > 0 && warnAtRatio < 1)) {
    fail("limits.warnAtRatio must satisfy 0 < r < 1", "limits.warnAtRatio");
  }
  const limits: LimitConfig = {
    maxCostUsd: expectPositiveNumber(limitMapping["maxCostUsd"], "limits.maxCostUsd"),
    warnAtRatio,
    continueIncrementUsd: expectPositiveNumber(
      limitMapping["continueIncrementUsd"],
      "limits.continueIncrementUsd",
    ),
    maxTurns: expectPositiveInteger(limitMapping["maxTurns"], "limits.maxTurns"),
    maxWallClockMinutes: expectPositiveInteger(
      limitMapping["maxWallClockMinutes"],
      "limits.maxWallClockMinutes",
    ),
    startDeadlineSeconds: expectPositiveInteger(
      limitMapping["startDeadlineSeconds"],
      "limits.startDeadlineSeconds",
    ),
  };

  const proposalMapping = expectMapping(root["proposal"], "proposal");
  rejectUnknownKeys(proposalMapping, PROPOSAL_KEYS, "proposal");
  const proposal: ProposalConfig = {
    maxChangedPaths: expectPositiveInteger(proposalMapping["maxChangedPaths"], "proposal.maxChangedPaths"),
    maxDiffLines: expectPositiveInteger(proposalMapping["maxDiffLines"], "proposal.maxDiffLines"),
  };

  const continuityMapping = expectMapping(root["continuity"], "continuity");
  rejectUnknownKeys(continuityMapping, ["sessionCacheKeyPrefix"], "continuity");
  const continuity: ContinuityConfig = {
    sessionCacheKeyPrefix: expectString(
      continuityMapping["sessionCacheKeyPrefix"],
      "continuity.sessionCacheKeyPrefix",
    ),
  };

  const networkMapping = expectMapping(root["network"], "network");
  rejectUnknownKeys(networkMapping, ["allowHosts"], "network");
  const allowHosts = expectStringList(networkMapping["allowHosts"], "network.allowHosts");
  if (allowHosts.length === 0) {
    fail("network.allowHosts must not be empty", "network.allowHosts");
  }
  for (const host of allowHosts) validateHost(host);

  const sweepMapping = expectMapping(root["sweep"], "sweep");
  rejectUnknownKeys(sweepMapping, ["graceMinutes"], "sweep");
  const sweep: SweepConfig = {
    graceMinutes: expectPositiveInteger(sweepMapping["graceMinutes"], "sweep.graceMinutes"),
  };
  if (sweep.graceMinutes <= limits.maxWallClockMinutes) {
    fail(
      "sweep.graceMinutes must be comfortably larger than limits.maxWallClockMinutes",
      "sweep.graceMinutes",
    );
  }

  const instructions = options.instructionsContent ?? "";
  const instructionsHash = sha256(instructions);
  const fingerprint = computeFingerprint({
    instructions,
    model,
    thinking,
    tools,
    promptTemplates,
  });

  const config: AgentConfig = {
    model,
    thinking,
    tools,
    promptTemplates,
    instructionsPath,
    labels,
    globalHaltIssue,
    limits,
    proposal,
    continuity,
    network: { allowHosts },
    sweep,
  };

  return { config, instructionsHash, fingerprint };
}

export function loadConfig(repoRoot: string = process.cwd()): LoadedConfig {
  const configPath = join(repoRoot, ".agent", "config.yml");
  if (!existsSync(configPath)) {
    fail(`configuration file is missing: ${configPath}`, ".agent/config.yml");
  }
  const source = readFileSync(configPath, "utf8");
  const raw = parseConfigYaml(source);

  const instructionsPathRaw =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as { [key: string]: YamlValue })["instructionsPath"]
      : undefined;
  const instructionsPath =
    typeof instructionsPathRaw === "string" ? instructionsPathRaw : ".agent/instructions.md";
  const absoluteInstructions = resolve(repoRoot, instructionsPath);
  if (!existsSync(absoluteInstructions)) {
    fail(`instructions file is missing: ${instructionsPath}`, "instructionsPath");
  }
  const instructions = readFileSync(absoluteInstructions, "utf8");

  const validated = validateConfig(raw, {
    repoRoot,
    instructionsContent: instructions,
    fileExists: (relativePath) => existsSync(resolve(repoRoot, relativePath)),
  });

  return {
    config: validated.config,
    instructions,
    instructionsHash: validated.instructionsHash,
    fingerprint: validated.fingerprint,
    configPath,
  };
}
