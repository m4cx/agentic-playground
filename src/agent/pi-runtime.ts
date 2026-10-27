/**
 * Pi runtime provisioning (plan.md amendment 2026-10-27, research D16/D17).
 *
 * The orchestrator never invokes `pi` from `PATH` and never relies on a global
 * install. It resolves the CLI entry of the pinned dependency under the
 * repository's `node_modules/`, asserts that the installed and locked versions
 * equal the exact dependency pin, and launches that entry with the running Node
 * binary.
 *
 * Failure is always `environment`: a missing, ranged, or mismatched pin, an entry
 * outside `node_modules/`, or a missing executable must stop the run before the
 * acknowledgement, not after a model call.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  statSync,
  unlinkSync,
  type Stats,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PI_PACKAGE = "@earendil-works/pi-coding-agent";

/** Keys the mode-0600 `AGENT_ENV_FILE` may carry. Anything else is a defect. */
export const AGENT_ENV_KEYS = ["GITHUB_TOKEN", "ANTHROPIC_API_KEY"] as const;

export class PiRuntimeError extends Error {
  readonly reason = "environment" as const;

  constructor(message: string) {
    super(message);
    this.name = "PiRuntimeError";
  }
}

export interface PiRuntime {
  /** Absolute path to the Node binary that runs the orchestrator. */
  nodePath: string;
  /** Absolute path to the pinned package's CLI entry. */
  entry: string;
  /** The installed version, which must equal the exact dependency pin. */
  version: string;
}

export interface PiRuntimeParts {
  repoRoot: string;
  packageRoot: string;
  entry: string;
  installedVersion: string;
  pinnedVersion: string;
  lockedVersion: string;
}

function readJson(path: string, label: string): unknown {
  if (!existsSync(path)) {
    throw new PiRuntimeError(`${label} is missing: ${path}`);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new PiRuntimeError(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function asMapping(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Read the exact dependency pin and the version recorded in the lockfile.
 *
 * The pin has one home: `package.json` plus `package-lock.json`. A range is not a
 * pin and fails closed; a lockfile that disagrees with the manifest means
 * `npm ci` and the reviewed dependency have diverged.
 */
export function readPinnedPiVersion(repoRoot: string): string {
  const packagePath = join(repoRoot, "package.json");
  const lockPath = join(repoRoot, "package-lock.json");

  const packageJson = asMapping(readJson(packagePath, "package.json"));
  if (packageJson === null) throw new PiRuntimeError(`package.json is not an object: ${packagePath}`);
  const dependencies = asMapping(packageJson["dependencies"]);
  const pinned = dependencies?.[PI_PACKAGE];
  if (typeof pinned !== "string" || pinned.length === 0) {
    throw new PiRuntimeError(
      `package.json#dependencies["${PI_PACKAGE}"] is missing; an exact version is required`,
    );
  }
  if (!/^\d+\.\d+\.\d+$/.test(pinned)) {
    throw new PiRuntimeError(
      `package.json#dependencies["${PI_PACKAGE}"] must be an exact version, got "${pinned}"`,
    );
  }

  const lock = asMapping(readJson(lockPath, "package-lock.json"));
  const packages = asMapping(lock?.["packages"]);
  const lockedEntry = asMapping(packages?.[`node_modules/${PI_PACKAGE}`]);
  const locked = lockedEntry?.["version"];
  if (typeof locked !== "string" || locked.length === 0) {
    throw new PiRuntimeError(
      `package-lock.json#packages["node_modules/${PI_PACKAGE}"].version is missing`,
    );
  }
  if (locked !== pinned) {
    throw new PiRuntimeError(
      `package-lock.json records ${PI_PACKAGE}@${locked}, but package.json pins ${pinned}`,
    );
  }
  return pinned;
}

function isInside(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Pure validation of the resolved runtime. Kept separate from path traversal so
 * tests can exercise every failure without touching `node_modules/`.
 */
export function assertPiRuntime(parts: PiRuntimeParts): PiRuntime {
  const nodeModules = resolve(parts.repoRoot, "node_modules");
  const packageRoot = resolve(parts.packageRoot);
  const entry = resolve(parts.entry);

  if (!isInside(nodeModules, packageRoot)) {
    throw new PiRuntimeError(
      `${PI_PACKAGE} resolved from ${packageRoot}, outside ${nodeModules}`,
    );
  }
  if (!isInside(nodeModules, entry)) {
    throw new PiRuntimeError(
      `${PI_PACKAGE} entry ${entry} is outside ${nodeModules}`,
    );
  }
  if (!/^\d+\.\d+\.\d+$/.test(parts.pinnedVersion)) {
    throw new PiRuntimeError(
      `the ${PI_PACKAGE} pin must be an exact version, got "${parts.pinnedVersion}"`,
    );
  }
  if (parts.lockedVersion !== parts.pinnedVersion) {
    throw new PiRuntimeError(
      `package-lock.json records ${PI_PACKAGE}@${parts.lockedVersion}, but package.json pins ${parts.pinnedVersion}`,
    );
  }
  if (parts.installedVersion !== parts.pinnedVersion) {
    throw new PiRuntimeError(
      `installed ${PI_PACKAGE}@${parts.installedVersion} does not match the pin ${parts.pinnedVersion}`,
    );
  }
  if (!existsSync(entry) || !statSync(entry).isFile()) {
    throw new PiRuntimeError(`${PI_PACKAGE} entry is not a file: ${entry}`);
  }

  return { nodePath: process.execPath, entry, version: parts.installedVersion };
}

function findPackageRoot(modulePath: string): string {
  let directory = dirname(modulePath);
  for (;;) {
    const candidate = join(directory, "package.json");
    if (existsSync(candidate)) {
      const parsed = asMapping(readJson(candidate, "package.json"));
      if (parsed?.["name"] === PI_PACKAGE) return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new PiRuntimeError(`could not locate ${PI_PACKAGE} package root from ${modulePath}`);
    }
    directory = parent;
  }
}

/**
 * Resolve the pinned package through Node's export map, then its `bin.pi` entry.
 * This ignores `PATH` and any globally installed `pi`.
 */
export function resolvePiRuntime(repoRoot: string = process.cwd()): PiRuntime {
  const pinnedVersion = readPinnedPiVersion(repoRoot);
  const lock = asMapping(
    asMapping(readJson(join(repoRoot, "package-lock.json"), "package-lock.json"))?.["packages"],
  );
  const lockedVersion = asMapping(lock?.[`node_modules/${PI_PACKAGE}`])?.["version"];
  if (typeof lockedVersion !== "string") {
    throw new PiRuntimeError(`package-lock.json has no version for ${PI_PACKAGE}`);
  }

  let resolvedUrl: string;
  try {
    resolvedUrl = import.meta.resolve(PI_PACKAGE);
  } catch (error) {
    throw new PiRuntimeError(
      `could not resolve ${PI_PACKAGE}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const modulePath = fileURLToPath(resolvedUrl);
  const packageRoot = findPackageRoot(modulePath);
  const packageJson = asMapping(readJson(join(packageRoot, "package.json"), "package.json"));
  const installedVersion = packageJson?.["version"];
  if (typeof installedVersion !== "string") {
    throw new PiRuntimeError(`${join(packageRoot, "package.json")} has no version`);
  }
  const bin = packageJson?.["bin"];
  const binPath =
    typeof bin === "string"
      ? bin
      : asMapping(bin)?.["pi"];
  if (typeof binPath !== "string" || binPath.length === 0) {
    throw new PiRuntimeError(`${PI_PACKAGE} does not declare a "pi" bin entry`);
  }

  return assertPiRuntime({
    repoRoot,
    packageRoot,
    entry: resolve(packageRoot, binPath),
    installedVersion,
    pinnedVersion,
    lockedVersion,
  });
}

/** Parse the egress uid from the environment; an invalid value is a defect. */
export function egressUidFromEnvironment(environment: NodeJS.ProcessEnv): number | undefined {
  const raw = environment["AGENT_EGRESS_UID"];
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) {
    throw new PiRuntimeError(`AGENT_EGRESS_UID must be a numeric uid, got "${raw}"`);
  }
  const uid = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(uid) || uid <= 0) {
    throw new PiRuntimeError(`AGENT_EGRESS_UID must be a positive uid, got "${raw}"`);
  }
  return uid;
}

/**
 * Dropping to the egress uid requires uid 0. There is deliberately no fallback
 * that runs Pi as root.
 */
export function assertOrchestratorPrivilege(
  egressUid: number | undefined,
  getuid: () => number | undefined = () => process.getuid?.(),
): void {
  if (egressUid === undefined) return;
  if (getuid() !== 0) {
    throw new PiRuntimeError(
      "AGENT_EGRESS_UID is set but the orchestrator is not uid 0; the job is missing the sudo privilege handoff",
    );
  }
}

/**
 * Read the mode-0600 secret file once, unlink it, and return only the allowlisted
 * keys. The file never enters the Pi child; `sanitizeEnvironment` removes them.
 */
export function readAgentEnvFile(path: string): Record<string, string> {
  let stats: Stats;
  try {
    stats = statSync(path);
  } catch (error) {
    throw new PiRuntimeError(
      `AGENT_ENV_FILE cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!stats.isFile()) throw new PiRuntimeError(`AGENT_ENV_FILE is not a file: ${path}`);
  if ((stats.mode & 0o777) !== 0o600) {
    throw new PiRuntimeError(`AGENT_ENV_FILE must be mode 0600, got ${(stats.mode & 0o777).toString(8)}`);
  }
  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // The orchestrator already owns the read; a failed unlink is reported below.
    }
  }
  const values: Record<string, string> = {};
  for (const line of source.split("\n")) {
    if (line.trim().length === 0 || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) throw new PiRuntimeError(`AGENT_ENV_FILE contains a malformed line`);
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!(AGENT_ENV_KEYS as readonly string[]).includes(key)) {
      throw new PiRuntimeError(`AGENT_ENV_FILE contains an unexpected key: ${key}`);
    }
    values[key] = value;
  }
  if (existsSync(path)) {
    throw new PiRuntimeError(`AGENT_ENV_FILE could not be removed: ${path}`);
  }
  return values;
}

/** Reap every process owned by the egress uid; used after the Pi group is killed. */
export function reapEgressProcesses(uid: number): void {
  if (process.getuid?.() !== 0) return;
  spawnSync("pkill", ["-KILL", "-u", String(uid)], { stdio: "ignore" });
}

/** Exposed for tests: the package root of a resolved module path. */
export function packageRootFor(modulePath: string): string {
  return findPackageRoot(modulePath);
}

/** Exposed for tests: a path is inside the repository's node_modules. */
export function isInsideNodeModules(repoRoot: string, candidate: string): boolean {
  return isInside(resolve(repoRoot, "node_modules"), resolve(candidate));
}
