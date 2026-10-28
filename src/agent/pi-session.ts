/**
 * Pi RPC lifecycle (contracts/pi-rpc.md, FR-031, FR-034).
 *
 * Only the documented RPC subset is used. The orchestrator owns the repository
 * credential; Pi is started with no GitHub token, no discovery, an explicit tool
 * allowlist, an explicit prompt-template allowlist, and a fingerprinted session id.
 *
 * Stop discipline: a halt or limit stop is applied at a `turn_end` boundary, never
 * mid-action. `abort` is therefore only sent from the boundary handler.
 */

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  chmodSync,
  chownSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { MODELS_CONFIG_PATH, type AgentConfig } from "./config.js";
import { reapEgressProcesses, type PiRuntime } from "./pi-runtime.js";

export interface SessionStats {
  costUsd: number;
  tokens: number;
  turns: number;
  toolCalls: number;
  assistantMessages: number;
}

export interface PiState {
  modelId: string | null;
  modelName: string | null;
  thinkingLevel: string | null;
  sessionId: string | null;
  isStreaming: boolean;
  messageCount: number;
  pendingMessageCount: number;
  tools: string[] | null;
}

/** Event types that prove the harness is continuing on its own (FR-031). */
export const RETRY_SIGNAL_EVENTS: ReadonlySet<string> = new Set([
  "auto_retry_start",
  "auto_retry_end",
  "summarization_retry_scheduled",
  "summarization_retry_attempt_start",
  "summarization_retry_finished",
  "compaction_start",
  "compaction_end",
]);

export class PiSessionError extends Error {
  readonly kind: "environment" | "unexpected-retry" | "agent-error";
  readonly signalName?: string;

  constructor(message: string, kind: PiSessionError["kind"], signalName?: string) {
    super(message);
    this.name = "PiSessionError";
    this.kind = kind;
    this.signalName = signalName;
  }
}

export interface SpawnLike {
  (
    command: string,
    args: readonly string[],
    options: Record<string, unknown>,
  ): ChildProcessWithoutNullStreams;
}

export interface PiSessionOptions {
  config: AgentConfig;
  repoRoot: string;
  issueNumber: number;
  fingerprint: string;
  sessionDir: string;
  /** Resolved from the pinned dependency, never from PATH (research D16). */
  runtime: PiRuntime;
  spawnImpl?: SpawnLike;
  env?: NodeJS.ProcessEnv;
  egressUid?: number;
  egressGid?: number;
  coldStart?: boolean;
  startDeadlineMs?: number;
  onBoundary?: (context: BoundaryContext) => Promise<void>;
  onEvent?: (event: Record<string, unknown>) => void;
  onDiagnostic?: (line: string) => void;
  /** Test seam for the uid-wide reap performed after the group is killed. */
  reapProcesses?: (uid: number) => void;
}

export interface BoundaryContext {
  boundaryIndex: number;
  stats: SessionStats;
  pendingSteering: number;
  pendingFollowUp: number;
}

/** Environment variables that must never reach the agent process. */
export const STRIPPED_ENVIRONMENT = [
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "GITHUB_ENV",
  "GITHUB_OUTPUT",
  "AGENT_ENV_FILE",
] as const;

export function sanitizeEnvironment(
  source: NodeJS.ProcessEnv,
  egressUid?: number,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...source };
  for (const key of STRIPPED_ENVIRONMENT) delete env[key];
  // Also strip any alternate GitHub token spelling.
  for (const key of Object.keys(env)) {
    if (/^(github|gh)_.*token$/i.test(key)) delete env[key];
  }
  if (egressUid !== undefined) {
    env["AGENT_EGRESS_UID"] = String(egressUid);
  }
  return env;
}

/** True when a session file for this identity exists in the cache directory. */
export function sessionCachePresent(sessionDir: string, sessionId: string): boolean {
  if (!existsSync(sessionDir)) return false;
  try {
    return readdirSync(sessionDir).some((entry) => entry.includes(sessionId));
  } catch {
    return false;
  }
}

/** Reject a cache-restored symlink instead of following it into a privileged path. */
function ensureRealDirectory(path: string): void {
  if (existsSync(path)) {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new PiSessionError(`session path is not a real directory: ${path}`, "environment");
    }
    return;
  }
  mkdirSync(path, { recursive: true });
}

export function sessionIdFor(issueNumber: number, fingerprint: string): string {
  return `agent-issue-${issueNumber}-${fingerprint.slice(0, 12)}`;
}

/**
 * The launch arguments, exactly as the contract lists them. One
 * `--prompt-template` per allowlist entry, discovery flags off, no forge tool.
 */
export function buildLaunchArgs(options: {
  config: AgentConfig;
  sessionId: string;
  sessionDir: string;
}): string[] {
  const { config } = options;
  const args = [
    "--mode",
    "rpc",
    "--offline",
    "--no-approve",
    "--no-extensions",
    "--no-skills",
    "--no-mcp",
    "--no-prompt-templates",
  ];
  for (const templatePath of config.promptTemplates) {
    args.push("--prompt-template", templatePath);
  }
  args.push(
    "--append-system-prompt",
    config.instructionsPath,
    "--tools",
    config.tools.join(","),
    "--model",
    config.model,
    "--thinking",
    config.thinking,
    "--session-id",
    options.sessionId,
    "--session-dir",
    options.sessionDir,
  );
  return args;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new PiSessionError(message, "environment")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * A live Pi session. The event reader starts before the first prompt so a fast
 * completion cannot be missed, and event handlers are serialized so a boundary is
 * processed exactly once, in order.
 */
export class PiSession {
  private readonly options: PiSessionOptions;
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly sessionId: string;
  private readonly stats: SessionStats = {
    costUsd: 0,
    tokens: 0,
    turns: 0,
    toolCalls: 0,
    assistantMessages: 0,
  };

  private buffer = "";
  private commandCounter = 0;
  private readonly pending = new Map<string, { resolve: (data: unknown) => void; reject: (error: Error) => void }>();
  private eventChain: Promise<void> = Promise.resolve();
  private eventError: Error | null = null;
  private settled = deferred<{ aborted: boolean }>();
  private settledValue: { aborted: boolean } | null = null;
  private retrySignal: string | null = null;
  private boundaryIndex = 0;
  private pendingSteering = 0;
  private pendingFollowUp = 0;
  private disposed = false;
  private readonly diagnostics: string[] = [];
  private readonly observedEvents: string[] = [];

  constructor(options: PiSessionOptions) {
    this.options = options;
    this.sessionId = sessionIdFor(options.issueNumber, options.fingerprint);
    const args = buildLaunchArgs({
      config: options.config,
      sessionId: this.sessionId,
      sessionDir: options.sessionDir,
    });
    const env = sanitizeEnvironment(options.env ?? process.env, options.egressUid);
    const spawnImpl: SpawnLike =
      options.spawnImpl ??
      ((command, spawnArgs, spawnOptions) => spawn(command, [...spawnArgs], spawnOptions) as ChildProcessWithoutNullStreams);

    // The egress user has no home of its own; give Pi writable directories under
    // the session cache. The workspace itself is prepared by prepareAgentWorkspace.
    const homeDir = join(options.sessionDir, "home");
    const tmpDir = join(options.sessionDir, "tmp");
    const cacheDir = join(options.sessionDir, "cache");
    const agentDir = join(options.sessionDir, "pi-agent");
    try {
      for (const directory of [options.sessionDir, homeDir, tmpDir, cacheDir, agentDir]) {
        ensureRealDirectory(directory);
        if (options.egressUid !== undefined && process.getuid?.() === 0) {
          chownSync(directory, options.egressUid, options.egressGid ?? options.egressUid);
        }
      }
      // Provider endpoints are repository content, not a machine-local file. The
      // copied file stays root-owned so the agent cannot redirect its own provider;
      // the directory stays writable so Pi's own migrations can run there.
      const modelsSource = join(options.repoRoot, MODELS_CONFIG_PATH);
      if (existsSync(modelsSource)) {
        const modelsTarget = join(agentDir, "models.json");
        writeFileSync(modelsTarget, readFileSync(modelsSource), { mode: 0o644 });
        // A cache-restored file keeps its old mode, so set it explicitly.
        chmodSync(modelsTarget, 0o644);
        if (options.egressUid !== undefined && process.getuid?.() === 0) {
          chownSync(modelsTarget, 0, 0);
        }
      }
    } catch (error) {
      if (error instanceof PiSessionError) throw error;
      throw new PiSessionError(
        `could not prepare the session directory: ${error instanceof Error ? error.message : String(error)}`,
        "environment",
      );
    }
    env["HOME"] = homeDir;
    env["TMPDIR"] = tmpDir;
    env["XDG_CACHE_HOME"] = cacheDir;
    env["PI_CODING_AGENT_DIR"] = agentDir;

    try {
      this.child = spawnImpl(options.runtime.nodePath, [options.runtime.entry, ...args], {
        cwd: options.repoRoot,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
        ...(options.egressUid === undefined ? {} : { uid: options.egressUid, gid: options.egressGid ?? options.egressUid }),
      });
    } catch (error) {
      throw new PiSessionError(
        `Pi failed to start: ${error instanceof Error ? error.message : String(error)}`,
        "environment",
      );
    }
    this.attach();
  }

  get currentSessionId(): string {
    return this.sessionId;
  }

  get piVersion(): string {
    return this.options.runtime.version;
  }

  get observedEventTypes(): readonly string[] {
    return this.observedEvents;
  }

  get diagnosticsText(): string {
    return this.diagnostics.join("\n");
  }

  get isColdStart(): boolean {
    return this.options.coldStart === true;
  }

  private attach(): void {
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      this.diagnostics.push(chunk);
      this.options.onDiagnostic?.(chunk);
    });
    this.child.stdin.on("error", (error: Error) => {
      // A teardown race after the run has settled must not crash the orchestrator.
      this.diagnostics.push(`stdin error: ${error.message}`);
    });
    this.child.on("error", (error) => {
      this.eventError = new PiSessionError(`Pi failed to start: ${error.message}`, "environment");
    });
    this.child.on("exit", (code, signal) => {
      if (this.settledValue === null) {
        this.settledValue = { aborted: code !== 0 };
        this.settled.resolve(this.settledValue);
      }
      if (code !== 0 && code !== null && this.eventError === null) {
        this.eventError = new PiSessionError(
          `Pi exited with code ${code}${signal === null ? "" : ` (${signal})`}`,
          "agent-error",
        );
      }
    });
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      // Split only on LF, as the protocol requires; a trailing CR is stripped.
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (line.trim().length === 0) continue;
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line) as Record<string, unknown>;
      } catch {
        this.diagnostics.push(`non-JSON stdout line ignored: ${line.slice(0, 200)}`);
        continue;
      }
      this.dispatch(record);
    }
  }

  private dispatch(record: Record<string, unknown>): void {
    if (record["type"] === "response") {
      const id = record["id"];
      if (typeof id === "string") {
        const handler = this.pending.get(id);
        if (handler !== undefined) {
          this.pending.delete(id);
          if (record["success"] === false) {
            handler.reject(new Error(String(record["error"] ?? "Pi command failed")));
          } else {
            handler.resolve(record["data"]);
          }
          return;
        }
      }
      return;
    }
    const type = typeof record["type"] === "string" ? record["type"] : "unknown";
    this.observedEvents.push(type);
    this.options.onEvent?.(record);
    if (RETRY_SIGNAL_EVENTS.has(type) && this.retrySignal === null) {
      this.retrySignal = type;
      // Do not wait: the event loop stops at the next boundary and aborts there.
    }
    if (type === "queue_update") {
      const steering = record["steering"];
      const followUp = record["followUp"];
      this.pendingSteering = Array.isArray(steering) ? steering.length : 0;
      this.pendingFollowUp = Array.isArray(followUp) ? followUp.length : 0;
    }
    this.eventChain = this.eventChain
      .then(() => this.handleEvent(record))
      .catch((error: unknown) => {
        this.eventError = this.eventError ?? (error instanceof Error ? error : new Error(String(error)));
      });
  }

  private async handleEvent(record: Record<string, unknown>): Promise<void> {
    const type = record["type"];
    if (type === "turn_end") {
      this.boundaryIndex += 1;
      const stats = await this.getSessionStats();
      this.stats.costUsd = stats.costUsd;
      this.stats.tokens = stats.tokens;
      this.stats.turns = stats.turns;
      this.stats.toolCalls = stats.toolCalls;
      this.stats.assistantMessages = stats.assistantMessages;
      await this.options.onBoundary?.({
        boundaryIndex: this.boundaryIndex,
        stats,
        pendingSteering: this.pendingSteering,
        pendingFollowUp: this.pendingFollowUp,
      });
      return;
    }
    if (type === "agent_end" && record["willRetry"] === true && this.retrySignal === null) {
      this.retrySignal = "agent_end.willRetry";
      return;
    }
    if (type === "agent_settled") {
      const value = { aborted: record["aborted"] === true };
      if (this.settledValue === null) {
        this.settledValue = value;
        this.settled.resolve(value);
      }
    }
  }

  private nextId(): string {
    this.commandCounter += 1;
    return `cmd-${this.commandCounter}`;
  }

  /** Send a command and await its correlated response. */
  async send<T = unknown>(command: Record<string, unknown>, timeoutMs = 60_000): Promise<T> {
    if (this.disposed || this.child.stdin.writableEnded) {
      throw new PiSessionError("the Pi session is closed", "environment");
    }
    const id = this.nextId();
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (data: unknown) => void, reject });
    });
    this.child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
    return withTimeout(promise, timeoutMs, `Pi did not respond to ${String(command["type"])}`);
  }

  async setAutoRetry(enabled: boolean): Promise<void> {
    await this.send({ type: "set_auto_retry", enabled });
  }

  async setAutoCompaction(enabled: boolean): Promise<void> {
    await this.send({ type: "set_auto_compaction", enabled });
  }

  async getState(): Promise<PiState> {
    const data = (await this.send<Record<string, unknown>>({ type: "get_state" })) ?? {};
    const model = data["model"];
    const modelMapping =
      typeof model === "object" && model !== null ? (model as Record<string, unknown>) : null;
    const toolsRaw = data["tools"] ?? data["toolNames"] ?? data["effectiveTools"];
    const tools = Array.isArray(toolsRaw)
      ? toolsRaw.map((entry) =>
          typeof entry === "string"
            ? entry
            : typeof entry === "object" && entry !== null && typeof (entry as { name?: unknown }).name === "string"
              ? String((entry as { name: string }).name)
              : "",
        ).filter((name) => name.length > 0)
      : null;
    return {
      modelId: typeof modelMapping?.["id"] === "string" ? String(modelMapping["id"]) : null,
      modelName: typeof modelMapping?.["name"] === "string" ? String(modelMapping["name"]) : null,
      thinkingLevel: typeof data["thinkingLevel"] === "string" ? String(data["thinkingLevel"]) : null,
      sessionId: typeof data["sessionId"] === "string" ? String(data["sessionId"]) : null,
      isStreaming: data["isStreaming"] === true,
      messageCount: typeof data["messageCount"] === "number" ? data["messageCount"] : 0,
      pendingMessageCount: typeof data["pendingMessageCount"] === "number" ? data["pendingMessageCount"] : 0,
      tools,
    };
  }

  /** Discoverable slash commands, used to assert the configured allowlist loaded. */
  async getCommands(): Promise<string[]> {
    const data = (await this.send<Record<string, unknown>>({ type: "get_commands" })) ?? {};
    const commands = data["commands"] ?? data["items"] ?? [];
    if (!Array.isArray(commands)) return [];
    return commands
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (typeof entry === "object" && entry !== null) {
          const name = (entry as { name?: unknown; command?: unknown });
          if (typeof name.name === "string") return name.name;
          if (typeof name.command === "string") return name.command;
        }
        return "";
      })
      .map((name) => name.replace(/^\//, ""))
      .filter((name) => name.length > 0);
  }

  /**
   * Assert that every configured template actually loaded. Explicit
   * `--prompt-template` paths load even with discovery off, but a Pi upgrade could
   * change that; a missing command fails the run with `environment` before the
   * first prompt instead of silently doing nothing (contracts/pi-rpc.md §7).
   */
  async assertConfiguredCommands(config: AgentConfig): Promise<void> {
    if (config.promptTemplates.length === 0) return;
    const available = await this.getCommands();
    for (const templatePath of config.promptTemplates) {
      const expected = basename(templatePath, ".md");
      if (!available.includes(expected)) {
        throw new PiSessionError(
          `configured prompt template ${templatePath} did not load as /${expected}`,
          "environment",
        );
      }
    }
  }

  async getSessionStats(): Promise<SessionStats> {
    const data = (await this.send<Record<string, unknown>>({ type: "get_session_stats" })) ?? {};
    const tokensRaw = data["tokens"];
    const tokensMapping =
      typeof tokensRaw === "object" && tokensRaw !== null ? (tokensRaw as Record<string, unknown>) : {};
    const costValue = typeof data["cost"] === "number" ? data["cost"] : 0;
    const assistantMessages =
      typeof data["assistantMessages"] === "number" ? data["assistantMessages"] : 0;
    return {
      costUsd: costValue,
      tokens: typeof tokensMapping["total"] === "number" ? tokensMapping["total"] : 0,
      turns: assistantMessages,
      toolCalls: typeof data["toolCalls"] === "number" ? data["toolCalls"] : 0,
      assistantMessages,
    };
  }

  /**
   * Assert the effective state before the first prompt: the model must be the
   * configured one, every effective tool must be allowlisted, and nothing may be
   * queued. A mismatch is an `environment` failure, not a run under old rules.
   */
  async assertEffectiveState(config: AgentConfig): Promise<PiState> {
    const state = await this.getState();
    if (state.modelId !== null && !modelMatches(config.model, state.modelId, state.modelName)) {
      throw new PiSessionError(
        `effective model ${state.modelId} does not match configured model ${config.model}`,
        "environment",
      );
    }
    if (state.tools !== null) {
      const unexpected = state.tools.filter((tool) => !config.tools.includes(tool));
      if (unexpected.length > 0) {
        throw new PiSessionError(
          `effective tool list contains tools outside the allowlist: ${unexpected.join(", ")}`,
          "environment",
        );
      }
    }
    if (state.pendingMessageCount > 0 || this.pendingSteering > 0 || this.pendingFollowUp > 0) {
      throw new PiSessionError("Pi has queued messages before the first prompt", "environment");
    }
    return state;
  }

  /**
   * Start a prompt and wait until Pi is settled. Returns the retry signal when the
   * harness showed one, so the caller can fail the run with `unexpected-retry`.
   */
  async promptAndSettle(message: string): Promise<{ aborted: boolean; retrySignal: string | null }> {
    this.settled = deferred<{ aborted: boolean }>();
    this.settledValue = null;
    const deadline = this.options.startDeadlineMs ?? this.options.config.limits.startDeadlineSeconds * 1000;
    const response = await withTimeout(
      this.send<{ disposition?: string }>({ type: "prompt", message }, deadline),
      deadline,
      "Pi did not accept the prompt within the start deadline",
    );
    if (response?.disposition === "handled") {
      return { aborted: false, retrySignal: this.retrySignal };
    }
    const settledResult = await this.settled.promise;
    await this.eventChain;
    if (this.eventError !== null) throw this.eventError;
    return { aborted: settledResult.aborted, retrySignal: this.retrySignal };
  }

  /** Abort at a boundary. The caller has already posted feedback. */
  async abortAtBoundary(): Promise<void> {
    await this.send({ type: "abort" }, 120_000);
  }

  /** Final assistant text of the session, used for the report blocks. */
  async getLastAssistantText(): Promise<string> {
    try {
      const data = (await this.send<Record<string, unknown>>({ type: "get_last_assistant_text" })) ?? {};
      const text = data["text"];
      return typeof text === "string" ? text : "";
    } catch {
      return "";
    }
  }

  get retrySignalSeen(): string | null {
    return this.retrySignal;
  }

  get currentStats(): SessionStats {
    return { ...this.stats };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.child.stdin.end();
    } catch {
      // stdin may already be closed
    }
    const exited = new Promise<void>((resolve) => {
      if (this.child.exitCode !== null) {
        resolve();
        return;
      }
      this.child.once("exit", () => resolve());
    });
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 10_000));
    await Promise.race([exited, timeout]);
    if (this.child.exitCode === null) {
      this.killGroup();
    }
    await this.reapEgress();
  }

  /** Signal every process of the egress uid, then wait briefly until none remain. */
  private async reapEgress(): Promise<void> {
    const uid = this.options.egressUid;
    if (uid === undefined) return;
    (this.options.reapProcesses ?? reapEgressProcesses)(uid);
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const remaining = spawnSync("pgrep", ["-u", String(uid)], { stdio: "ignore" });
      if (remaining.error !== undefined || remaining.status !== 0) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /** Kill the detached process group, including children the agent started. */
  private killGroup(): void {
    const pid = this.child.pid;
    if (pid === undefined) return;
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        this.child.kill("SIGKILL");
      } catch {
        // The process is already gone.
      }
    }
  }
}

/** A configured `provider/id` matches Pi's reported id or name. */
export function modelMatches(configured: string, reportedId: string | null, reportedName: string | null): boolean {
  const normalise = (value: string): string => value.toLowerCase().replace(/^[a-z0-9._-]+\//, "");
  const wanted = normalise(configured);
  if (reportedId !== null && normalise(reportedId) === wanted) return true;
  if (reportedName !== null && normalise(reportedName) === wanted) return true;
  // Accept a reported id that extends the configured one (dated model alias).
  return reportedId !== null && normalise(reportedId).startsWith(wanted);
}
