import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AgentError } from "./errors.js";
import type { AgentConfig } from "./config.js";

export const PINNED_PI_VERSION = "1.4.0";

export function resolvePiCli(rootDir: string): string {
  return path.join(
    rootDir,
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "bundle",
    "cli.js",
  );
}

export function readPiVersion(rootDir: string): string {
  const packagePath = path.join(
    rootDir,
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "package.json",
  );
  try {
    const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: string };
    return parsed.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function assertPiVersion(rootDir: string, expected = PINNED_PI_VERSION): string {
  const version = readPiVersion(rootDir);
  if (version !== expected) {
    throw new AgentError(
      "environment",
      `expected @earendil-works/pi-coding-agent ${expected}, found ${version}`,
    );
  }
  return version;
}

function readDefaultBranchFile(repoRoot: string, defaultBranch: string, relativePath: string): string {
  try {
    return execFileSync("git", ["show", `origin/${defaultBranch}:${relativePath}`], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    const fallback = path.join(repoRoot, relativePath);
    if (!existsSync(fallback)) {
      throw new AgentError("environment", `cannot read ${relativePath} from the default branch`);
    }
    return readFileSync(fallback, "utf8");
  }
}

export interface MaterializedRuntime {
  runtimeDir: string;
  homeDir: string;
  sessionDir: string;
  instructionsPath: string;
}

export function materializeRuntime(input: {
  repoRoot: string;
  runtimeDir: string;
  defaultBranch: string;
  sessionDir?: string;
}): MaterializedRuntime {
  const runtimeDir = path.resolve(input.runtimeDir);
  const homeDir = path.join(runtimeDir, "home");
  const sessionDir = input.sessionDir ? path.resolve(input.sessionDir) : path.join(runtimeDir, "sessions");
  const agentDir = path.join(runtimeDir, "agent");
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });
  mkdirSync(agentDir, { recursive: true });

  const files = [".agent/instructions.md", ".agent/config.json", ".agent/models.json"];
  for (const relative of files) {
    const content = readDefaultBranchFile(input.repoRoot, input.defaultBranch, relative);
    const destination = path.join(runtimeDir, relative);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, content, "utf8");
  }
  // Pi reads models.json from its config directory.
  copyFileSync(path.join(runtimeDir, ".agent", "models.json"), path.join(agentDir, "models.json"));
  chmodSync(homeDir, 0o777);
  chmodSync(sessionDir, 0o777);
  chmodSync(agentDir, 0o755);

  return {
    runtimeDir,
    homeDir,
    sessionDir,
    instructionsPath: path.join(runtimeDir, ".agent", "instructions.md"),
  };
}

export interface ChildEnvironmentInput {
  runtime: MaterializedRuntime;
  config: AgentConfig;
  workspaceDir: string;
}

export function buildChildEnvironment(input: ChildEnvironmentInput): Record<string, string> {
  const allowedKeys = ["PATH", "LANG", "LC_ALL", "TZ", "OLLAMA_API_KEY", "NODE_OPTIONS"];
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: input.runtime.homeDir,
    CI: "1",
    PI_CODING_AGENT_DIR: path.join(input.runtime.runtimeDir, "agent"),
    PI_CODING_AGENT_SESSION_DIR: input.runtime.sessionDir,
    PI_OFFLINE: "0",
  };

  for (const key of allowedKeys) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  for (const key of Object.keys(env)) {
    if (key.startsWith("GITHUB_") || key.startsWith("ACTIONS_") || key.startsWith("RUNNER_")) {
      delete env[key];
    }
  }

  // The model id is part of the command line, not the environment.
  return env;
}

export function assertNoRepositoryCredentials(env: Record<string, string>): void {
  for (const key of Object.keys(env)) {
    if (key === "GITHUB_TOKEN" || key.startsWith("ACTIONS_") || key.startsWith("RUNNER_")) {
      throw new AgentError("environment", `child environment must not contain ${key}`);
    }
  }
}
