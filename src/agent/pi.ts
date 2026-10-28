import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { AgentError, errorMessage } from "./errors.js";
import type { AgentConfig } from "./config.js";
import type { MaterializedRuntime } from "./pi-runtime.js";
import { buildChildEnvironment, resolvePiCli } from "./pi-runtime.js";

export interface PiRunRequest {
  workspaceDir: string;
  prompt: string;
  sessionId: string;
  config: AgentConfig;
  runtime: MaterializedRuntime;
  runAsUser?: string;
  onEvent?: (event: Record<string, unknown>) => void;
}

export interface PiRunResult {
  text: string;
  stats: unknown;
}

export interface PiRunner {
  run(request: PiRunRequest): Promise<PiRunResult>;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class RpcPiRunner implements PiRunner {
  private readonly repoRoot: string;

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
  }

  async run(request: PiRunRequest): Promise<PiRunResult> {
    const cliPath = resolvePiCli(this.repoRoot);
    const env = buildChildEnvironment({
      runtime: request.runtime,
      config: request.config,
      workspaceDir: request.workspaceDir,
    });
    const args = [
      "--mode",
      "rpc",
      "--session-id",
      request.sessionId,
      "--session-dir",
      request.runtime.sessionDir,
      "--model",
      request.config.model,
      "--thinking",
      request.config.thinking,
      "--tools",
      request.config.tools.join(","),
      "--no-approve",
      "--no-extensions",
      "--no-mcp",
      "--append-system-prompt",
      request.runtime.instructionsPath,
    ];

    const child = this.spawn(cliPath, args, env, request.workspaceDir, request.runAsUser);
    const pending = new Map<string, Pending>();
    const listeners = new Set<(event: Record<string, unknown>) => void>();
    if (request.onEvent) {
      listeners.add(request.onEvent);
    }
    let nextId = 1;
    let retrySeen = false;
    let settled = false;
    let settleResolve: (() => void) | null = null;
    let settleReject: ((error: Error) => void) | null = null;
    const settledPromise = new Promise<void>((resolve, reject) => {
      settleResolve = resolve;
      settleReject = reject;
    });
    let stderr = "";
    let buffer = "";

    const failAll = (error: Error): void => {
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(error);
        pending.delete(id);
      }
      settleReject?.(error);
    };

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (line.trim().length > 0) {
          this.handleLine(line, pending, listeners, () => {
            retrySeen = true;
          }, () => {
            settled = true;
            settleResolve?.();
          });
        }
        newline = buffer.indexOf("\n");
      }
    });

    child.on("error", (error) => {
      failAll(new AgentError("environment", `cannot start Pi: ${errorMessage(error)}`));
    });

    child.on("exit", (code, signal) => {
      if (!settled && (code !== 0 || signal)) {
        failAll(
          new AgentError(
            "environment",
            `Pi exited before settling (code ${code ?? "null"}, signal ${signal ?? "none"}): ${stderr.slice(0, 500)}`,
          ),
        );
      }
    });

    const send = (command: Record<string, unknown>, timeoutMs = 30_000): Promise<unknown> => {
      const id = `req-${nextId}`;
      nextId += 1;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new AgentError("environment", `Pi command ${String(command.type)} timed out`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
      });
    };

    try {
      await send({ type: "set_auto_retry", enabled: false });
      const state = (await send({ type: "get_state" })) as { sessionId?: string };
      if (state.sessionId && state.sessionId !== request.sessionId) {
        throw new AgentError(
          "environment",
          `Pi session id mismatch: expected ${request.sessionId}, got ${state.sessionId}`,
        );
      }

      const disposition = (await send({ type: "prompt", message: request.prompt })) as {
        disposition?: string;
      };
      if (disposition.disposition !== "handled") {
        await this.waitFor(settledPromise, request.config.agentDeadlineMinutes * 60_000);
      }
      if (retrySeen) {
        throw new AgentError("unexpected-retry", "Pi reported an automatic retry");
      }

      const text = ((await send({ type: "get_last_assistant_text" })) as { text?: string | null })
        .text;
      if (typeof text !== "string") {
        throw new AgentError("agent-output", "Pi produced no final assistant text");
      }
      let stats: unknown = null;
      try {
        stats = await send({ type: "get_session_stats" }, 10_000);
      } catch {
        stats = null;
      }

      return { text, stats };
    } catch (error) {
      if (error instanceof AgentError && error.code === "timeout") {
        await this.abort(child, send);
      }
      throw error;
    } finally {
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(new AgentError("environment", "Pi process is closing"));
        pending.delete(id);
      }
      await this.shutdown(child);
    }
  }

  private spawn(
    cliPath: string,
    args: string[],
    env: Record<string, string>,
    cwd: string,
    runAsUser?: string,
  ): ChildProcessWithoutNullStreams {
    const envPairs = Object.entries(env).map(([key, value]) => `${key}=${value}`);
    const command = runAsUser ? "sudo" : "node";
    const commandArgs = runAsUser
      ? ["-n", "-u", runAsUser, "env", ...envPairs, "node", cliPath, ...args]
      : [cliPath, ...args];
    return spawn(command, commandArgs, {
      cwd,
      env: runAsUser ? { PATH: env.PATH ?? "/usr/bin:/bin" } : env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });
  }

  private handleLine(
    line: string,
    pending: Map<string, Pending>,
    listeners: Set<(event: Record<string, unknown>) => void>,
    onRetry: () => void,
    onSettled: () => void,
  ): void {
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (record.type === "response") {
      const id = typeof record.id === "string" ? record.id : null;
      if (id) {
        const entry = pending.get(id);
        if (entry) {
          clearTimeout(entry.timer);
          pending.delete(id);
          if (record.success === false) {
            entry.reject(new AgentError("environment", String(record.error ?? "Pi command failed")));
          } else {
            entry.resolve(record.data);
          }
        }
      }
      return;
    }
    if (record.type === "agent_settled") {
      onSettled();
    }
    if (typeof record.type === "string" && record.type.includes("retry")) {
      onRetry();
    }
    for (const listener of listeners) {
      listener(record);
    }
  }

  private async waitFor(promise: Promise<void>, timeoutMs: number): Promise<void> {
    let timer: NodeJS.Timeout | null = null;
    const timeout = new Promise<void>((_, reject) => {
      timer = setTimeout(() => {
        reject(new AgentError("timeout", `agent deadline of ${timeoutMs / 60000} minutes reached`));
      }, timeoutMs);
    });
    try {
      await Promise.race([promise, timeout]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private async abort(
    child: ChildProcessWithoutNullStreams,
    request: (command: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>,
  ): Promise<void> {
    try {
      await request({ type: "abort" }, 5_000);
    } catch {
      // The process may already be gone; the shutdown below is the fallback.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    if (!child.killed) {
      try {
        process.kill(-child.pid!, "SIGTERM");
      } catch {
        // Already gone.
      }
    }
  }

  private async shutdown(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (child.stdin.writable) {
      child.stdin.end();
    }
    const exited = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
    });
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 10_000));
    await Promise.race([exited, timeout]);
    if (child.exitCode === null && !child.killed) {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }
}
