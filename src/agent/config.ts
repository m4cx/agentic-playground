import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { AgentError } from "./errors.js";

export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const ALLOWED_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;
export type AgentTool = (typeof ALLOWED_TOOLS)[number];

export interface NetworkConfig {
  allowHosts: string[];
}

export interface AgentConfig {
  version: 1;
  triggerLabel: string;
  resumeCommand: string;
  slugMaxLength: number;
  maxComments: number;
  maxCommentCharacters: number;
  model: string;
  thinking: ThinkingLevel;
  tools: AgentTool[];
  instructionsPath: string;
  agentDeadlineMinutes: number;
  network: NetworkConfig;
}

export interface ModelDefinition {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: string[];
}

export interface ProviderDefinition {
  name?: string;
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  models?: ModelDefinition[];
}

export interface ModelsConfig {
  providers: Record<string, ProviderDefinition>;
}

export interface LoadedConfig {
  config: AgentConfig;
  models: ModelsConfig;
  instructions: string;
  fingerprint: string;
}

const CONFIG_KEYS = new Set([
  "version",
  "triggerLabel",
  "resumeCommand",
  "slugMaxLength",
  "maxComments",
  "maxCommentCharacters",
  "model",
  "thinking",
  "tools",
  "instructionsPath",
  "agentDeadlineMinutes",
  "network",
]);

const NETWORK_KEYS = new Set(["allowHosts"]);
const PROVIDER_KEYS = new Set(["name", "baseUrl", "api", "apiKey", "models"]);
const MODEL_KEYS = new Set(["id", "name", "reasoning", "input"]);

function fail(message: string): never {
  throw new AgentError("environment", `config: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKnownKeys(value: Record<string, unknown>, allowed: Set<string>, where: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail(`unknown key "${key}" in ${where}`);
    }
  }
}

function assertString(value: unknown, where: string, min: number, max: number): string {
  if (typeof value !== "string") {
    fail(`${where} must be a string`);
  }
  if (value.length < min || value.length > max) {
    fail(`${where} must be ${min}..${max} characters`);
  }
  return value;
}

function assertInteger(value: unknown, where: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    fail(`${where} must be an integer in ${min}..${max}`);
  }
  return value;
}

function assertBoolean(value: unknown, where: string): boolean {
  if (typeof value !== "boolean") {
    fail(`${where} must be a boolean`);
  }
  return value;
}

function assertStringArray(value: unknown, where: string): string[] {
  if (!Array.isArray(value)) {
    fail(`${where} must be an array`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string") {
      fail(`${where}[${index}] must be a string`);
    }
    return item;
  });
}

function parseJsonFile(filePath: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    fail(`cannot read ${filePath}`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    fail(`${filePath} is not valid JSON`);
  }
}

export function validateConfig(raw: unknown, models: ModelsConfig, instructions: string): AgentConfig {
  if (!isRecord(raw)) {
    fail("root must be an object");
  }
  assertKnownKeys(raw, CONFIG_KEYS, "config");

  if (raw.version !== 1) {
    fail("version must be exactly 1");
  }

  const triggerLabel = assertString(raw.triggerLabel, "triggerLabel", 1, 50);
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,49}$/.test(triggerLabel)) {
    fail("triggerLabel must match ^[A-Za-z0-9][A-Za-z0-9:_-]{0,49}$");
  }

  const resumeCommand = assertString(raw.resumeCommand, "resumeCommand", 1, 40);
  if (!resumeCommand.startsWith("/") || resumeCommand.includes("\n") || resumeCommand.includes("\r")) {
    fail("resumeCommand must start with / and contain no newline");
  }

  const slugMaxLength = assertInteger(raw.slugMaxLength, "slugMaxLength", 1, 50);
  const maxComments = assertInteger(raw.maxComments, "maxComments", 1, 500);
  const maxCommentCharacters = assertInteger(
    raw.maxCommentCharacters,
    "maxCommentCharacters",
    500,
    50000,
  );
  const agentDeadlineMinutes = assertInteger(
    raw.agentDeadlineMinutes,
    "agentDeadlineMinutes",
    5,
    120,
  );

  const model = assertString(raw.model, "model", 1, 200);
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) {
    fail("model must be provider/model");
  }
  const providerId = model.slice(0, slash);
  const modelId = model.slice(slash + 1);
  const provider = models.providers[providerId];
  if (!provider) {
    fail(`model provider "${providerId}" is not defined in models.json`);
  }
  if (!provider.models?.some((entry) => entry.id === modelId)) {
    fail(`model "${modelId}" is not defined for provider "${providerId}"`);
  }

  if (typeof raw.thinking !== "string" || !THINKING_LEVELS.includes(raw.thinking as ThinkingLevel)) {
    fail(`thinking must be one of ${THINKING_LEVELS.join(", ")}`);
  }
  const thinking = raw.thinking as ThinkingLevel;

  const tools = assertStringArray(raw.tools, "tools");
  if (tools.length === 0) {
    fail("tools must not be empty");
  }
  if (new Set(tools).size !== tools.length) {
    fail("tools must not contain duplicates");
  }
  for (const tool of tools) {
    if (!ALLOWED_TOOLS.includes(tool as AgentTool)) {
      fail(`tool "${tool}" is not allowed`);
    }
  }

  const instructionsPath = assertString(raw.instructionsPath, "instructionsPath", 1, 500);
  if (path.isAbsolute(instructionsPath) || instructionsPath.split(/[\\/]/).includes("..")) {
    fail("instructionsPath must be repository-relative and must not contain ..");
  }
  if (instructions.length > 100 * 1024) {
    fail("instructions file must be at most 100 KB");
  }

  if (!isRecord(raw.network)) {
    fail("network must be an object");
  }
  assertKnownKeys(raw.network, NETWORK_KEYS, "network");
  const allowHosts = assertStringArray(raw.network.allowHosts, "network.allowHosts");
  if (allowHosts.length === 0) {
    fail("network.allowHosts must not be empty");
  }
  if (new Set(allowHosts).size !== allowHosts.length) {
    fail("network.allowHosts must not contain duplicates");
  }
  for (const host of allowHosts) {
    if (!/^(?=.{1,253}$)([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(host)) {
      fail(`network.allowHosts contains an invalid host: ${host}`);
    }
  }

  const baseUrl = provider.baseUrl;
  if (!baseUrl) {
    fail(`provider "${providerId}" has no baseUrl`);
  }
  let providerHost: string;
  try {
    providerHost = new URL(baseUrl).hostname;
  } catch {
    fail(`provider "${providerId}" has an invalid baseUrl`);
  }
  if (!allowHosts.includes(providerHost)) {
    fail(`network.allowHosts must include the provider host "${providerHost}"`);
  }

  return {
    version: 1,
    triggerLabel,
    resumeCommand,
    slugMaxLength,
    maxComments,
    maxCommentCharacters,
    model,
    thinking,
    tools: tools as AgentTool[],
    instructionsPath,
    agentDeadlineMinutes,
    network: { allowHosts },
  };
}

export function validateModels(raw: unknown): ModelsConfig {
  if (!isRecord(raw)) {
    fail("models.json root must be an object");
  }
  assertKnownKeys(raw, new Set(["$schema", "providers"]), "models.json");
  if (!isRecord(raw.providers)) {
    fail("models.json providers must be an object");
  }
  const providers: Record<string, ProviderDefinition> = {};
  for (const [providerId, value] of Object.entries(raw.providers)) {
    if (!isRecord(value)) {
      fail(`provider "${providerId}" must be an object`);
    }
    assertKnownKeys(value, PROVIDER_KEYS, `provider "${providerId}"`);
    if (value.baseUrl !== undefined && typeof value.baseUrl !== "string") {
      fail(`provider "${providerId}".baseUrl must be a string`);
    }
    if (value.api !== undefined && typeof value.api !== "string") {
      fail(`provider "${providerId}".api must be a string`);
    }
    if (value.apiKey !== undefined && typeof value.apiKey !== "string") {
      fail(`provider "${providerId}".apiKey must be a string`);
    }
    if (value.name !== undefined && typeof value.name !== "string") {
      fail(`provider "${providerId}".name must be a string`);
    }
    const models: ModelDefinition[] = [];
    if (value.models !== undefined) {
      if (!Array.isArray(value.models)) {
        fail(`provider "${providerId}".models must be an array`);
      }
      for (const [index, entry] of value.models.entries()) {
        if (!isRecord(entry)) {
          fail(`provider "${providerId}".models[${index}] must be an object`);
        }
        assertKnownKeys(entry, MODEL_KEYS, `provider "${providerId}".models[${index}]`);
        if (typeof entry.id !== "string" || entry.id.length === 0) {
          fail(`provider "${providerId}".models[${index}].id must be a non-empty string`);
        }
        if (entry.name !== undefined && typeof entry.name !== "string") {
          fail(`provider "${providerId}".models[${index}].name must be a string`);
        }
        if (entry.reasoning !== undefined) {
          assertBoolean(entry.reasoning, `provider "${providerId}".models[${index}].reasoning`);
        }
        if (entry.input !== undefined) {
          assertStringArray(entry.input, `provider "${providerId}".models[${index}].input`);
        }
        models.push({
          id: entry.id,
          name: typeof entry.name === "string" ? entry.name : undefined,
          reasoning: typeof entry.reasoning === "boolean" ? entry.reasoning : undefined,
          input: Array.isArray(entry.input) ? (entry.input as string[]) : undefined,
        });
      }
    }
    providers[providerId] = {
      name: typeof value.name === "string" ? value.name : undefined,
      baseUrl: typeof value.baseUrl === "string" ? value.baseUrl : undefined,
      api: typeof value.api === "string" ? value.api : undefined,
      apiKey: typeof value.apiKey === "string" ? value.apiKey : undefined,
      models,
    };
  }
  return { providers };
}

export function computeFingerprint(
  config: AgentConfig,
  models: ModelsConfig,
  instructions: string,
  piVersion = "1.4.0",
): string {
  const hash = createHash("sha256");
  hash.update(instructions);
  hash.update(JSON.stringify(config));
  hash.update(JSON.stringify(models));
  hash.update(config.model);
  hash.update([...config.tools].sort().join(","));
  hash.update(piVersion);
  return hash.digest("hex").slice(0, 8);
}

export function loadConfig(rootDir: string): LoadedConfig {
  const configPath = path.join(rootDir, ".agent", "config.json");
  const modelsPath = path.join(rootDir, ".agent", "models.json");

  const rawConfig = parseJsonFile(configPath);
  const models = validateModels(parseJsonFile(modelsPath));

  if (!isRecord(rawConfig)) {
    fail("config root must be an object");
  }
  const instructionsPath = path.join(rootDir, String(rawConfig.instructionsPath ?? ""));
  let instructions: string;
  try {
    if (!statSync(instructionsPath).isFile()) {
      fail("instructionsPath must point to a file");
    }
    instructions = readFileSync(instructionsPath, "utf8");
  } catch (error) {
    if (error instanceof AgentError) {
      throw error;
    }
    fail("cannot read instructions file");
  }

  const config = validateConfig(rawConfig, models, instructions);
  return {
    config,
    models,
    instructions,
    fingerprint: computeFingerprint(config, models, instructions),
  };
}
