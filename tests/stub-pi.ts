/**
 * A fake Pi RPC peer (JSONL over stdio) for orchestrator tests.
 *
 * It answers the documented subset of commands the orchestrator uses and emits a
 * scripted event stream. Behaviour is controlled through environment variables so
 * a test can spawn it exactly like the real binary:
 *
 *   STUB_PI_TURNS               turns emitted per prompt (default 1)
 *   STUB_PI_TURN_DELAY_MS       delay between events (default 5)
 *   STUB_PI_COST_PER_TURN       cost added per turn in USD (default 0.25)
 *   STUB_PI_TOKENS_PER_TURN     tokens added per turn (default 1000)
 *   STUB_PI_TOOL_CALLS_PER_TURN tool calls reported per turn (default 1)
 *   STUB_PI_TOOLS               comma separated effective tool list
 *   STUB_PI_MODEL               model id reported by get_state (default configured model)
 *   STUB_PI_TEXT                assistant text of every turn
 *   STUB_PI_RETRY_SIGNAL        event type emitted instead of completing (e.g.
 *                               summarization_retry_scheduled, compaction_start, auto_retry_start)
 *   STUB_PI_WILL_RETRY          "1" to set willRetry on agent_end
 *   STUB_PI_LOG                 path of a JSONL file recording every received record
 */

import { appendFileSync, writeFileSync } from "node:fs";

export interface StubOptions {
  turns?: number;
  turnDelayMs?: number;
  costPerTurn?: number;
  tokensPerTurn?: number;
  toolCallsPerTurn?: number;
  tools?: string[];
  modelId?: string;
  text?: string;
  retrySignal?: string | null;
  willRetry?: boolean;
  logPath?: string;
}

const DEFAULT_TEXT = "Work complete.\n\nagent-ignored: none\n";

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function readOptions(): StubOptions {
  const retrySignal = process.env["STUB_PI_RETRY_SIGNAL"];
  const tools = process.env["STUB_PI_TOOLS"];
  return {
    turns: intFromEnv("STUB_PI_TURNS", 1),
    turnDelayMs: intFromEnv("STUB_PI_TURN_DELAY_MS", 5),
    costPerTurn: Number(process.env["STUB_PI_COST_PER_TURN"] ?? "0.25"),
    tokensPerTurn: intFromEnv("STUB_PI_TOKENS_PER_TURN", 1000),
    toolCallsPerTurn: intFromEnv("STUB_PI_TOOL_CALLS_PER_TURN", 1),
    tools: tools ? tools.split(",").map((tool) => tool.trim()) : ["read", "bash", "edit", "write", "grep", "find", "ls"],
    modelId: process.env["STUB_PI_MODEL"] ?? "kimi-k2.7-code",
    text: process.env["STUB_PI_TEXT"] ?? DEFAULT_TEXT,
    retrySignal: retrySignal && retrySignal.length > 0 ? retrySignal : null,
    willRetry: process.env["STUB_PI_WILL_RETRY"] === "1",
    logPath: process.env["STUB_PI_LOG"],
  };
}

function readPromptTemplates(argv: string[]): string[] {
  const templates: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--prompt-template") {
      const value = argv[index + 1];
      if (value !== undefined) templates.push(value.replace(/^.*\//, "").replace(/\.md$/, ""));
    }
  }
  return templates;
}

function readSessionId(argv: string[]): string {
  const index = argv.indexOf("--session-id");
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value ?? "stub-session";
}

interface Usage {
  costUsd: number;
  tokens: number;
  turns: number;
  toolCalls: number;
}

class StubPeer {
  private readonly options: StubOptions;
  private readonly sessionId: string;
  private readonly usage: Usage = { costUsd: 0, tokens: 0, turns: 0, toolCalls: 0 };
  private lastAssistantText = "";
  private buffer = "";
  private aborted = false;
  private running = false;
  private promptCount = 0;

  constructor(options: StubOptions, sessionId: string) {
    this.options = options;
    this.sessionId = sessionId;
    if (options.logPath) {
      writeFileSync(options.logPath, "");
      this.log({
        type: "stub_start",
        env: {
          hasGithubToken: Boolean(process.env["GITHUB_TOKEN"] ?? process.env["GH_TOKEN"]),
          hasProviderKey: Boolean(process.env["OLLAMA_API_KEY"]),
        },
      });
    }
  }

  start(): void {
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => this.onData(chunk));
    process.stdin.on("end", () => {
      process.exit(0);
    });
  }

  private log(record: unknown): void {
    if (!this.options.logPath) return;
    appendFileSync(this.options.logPath, `${JSON.stringify(record)}\n`);
  }

  private emit(record: Record<string, unknown>): void {
    this.log({ type: "event", event: record["type"] });
    process.stdout.write(`${JSON.stringify(record)}\n`);
  }

  private respond(command: Record<string, unknown>, success: boolean, data?: unknown, error?: string): void {
    const response: Record<string, unknown> = {
      type: "response",
      command: command["type"],
      success,
    };
    if (command["id"] !== undefined) response["id"] = command["id"];
    if (data !== undefined) response["data"] = data;
    if (error !== undefined) response["error"] = error;
    this.emit(response);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (line.trim().length === 0) continue;
      let command: Record<string, unknown>;
      try {
        command = JSON.parse(line) as Record<string, unknown>;
      } catch {
        this.emit({ type: "response", command: "parse", success: false, error: "invalid json" });
        continue;
      }
      this.log({ type: "command", command });
      this.handle(command);
    }
  }

  private handle(command: Record<string, unknown>): void {
    switch (command["type"]) {
      case "get_state":
        this.respond(command, true, {
          model: { id: this.options.modelId, provider: "ollama-cloud", name: "Stub Model" },
          thinkingLevel: "high",
          isStreaming: this.running,
          isCompacting: false,
          steeringMode: "all",
          followUpMode: "one-at-a-time",
          sessionId: this.sessionId,
          autoCompactionEnabled: false,
          messageCount: this.usage.turns * 2,
          pendingMessageCount: 0,
          tools: this.options.tools,
        });
        return;
      case "get_session_stats":
        this.respond(command, true, {
          sessionId: this.sessionId,
          userMessages: this.promptCount,
          assistantMessages: this.usage.turns,
          toolCalls: this.usage.toolCalls,
          toolResults: this.usage.toolCalls,
          totalMessages: this.usage.turns * 2,
          tokens: { input: this.usage.tokens, output: 0, cacheRead: 0, cacheWrite: 0, total: this.usage.tokens },
          cost: this.usage.costUsd,
        });
        return;
      case "set_auto_retry":
      case "set_auto_compaction":
        this.respond(command, true);
        return;
      case "clear_queue":
        this.respond(command, true, { steering: [], followUp: [] });
        return;
      case "get_messages":
        this.respond(command, true, { messages: [] });
        return;
      case "get_commands": {
        const configured = process.env["STUB_PI_COMMANDS"];
        const commands = configured === undefined ? readPromptTemplates(process.argv.slice(2)) : configured.split(",");
        this.respond(command, true, { commands: commands.filter((name) => name.length > 0) });
        return;
      }
      case "get_last_assistant_text":
        this.respond(command, true, { text: this.lastAssistantText });
        return;
      case "abort":
        this.aborted = true;
        this.respond(command, true);
        if (!this.running) {
          this.emit({ type: "agent_settled", aborted: true });
        }
        return;
      case "prompt":
        this.promptCount += 1;
        this.respond(command, true, { disposition: "started" });
        void this.runPrompt();
        return;
      default:
        this.respond(command, false, undefined, `unsupported command: ${String(command["type"])}`);
    }
  }

  private delay(): Promise<void> {
    const ms = this.options.turnDelayMs ?? 5;
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async runPrompt(): Promise<void> {
    this.running = true;
    this.emit({ type: "agent_start" });
    await this.delay();

    if (this.options.retrySignal) {
      this.emit({ type: "turn_start" });
      this.emit({ type: "turn_end", message: { role: "assistant", content: [] }, toolResults: [] });
      this.emit({ type: this.options.retrySignal, attempt: 1, maxAttempts: 3, delayMs: 10 });
      await this.delay();
      this.running = false;
      this.emit({ type: "agent_end", messages: [], willRetry: false });
      this.emit({ type: "agent_settled", aborted: false });
      return;
    }

    const turns = Math.max(0, this.options.turns ?? 1);
    for (let index = 0; index < turns; index += 1) {
      if (this.aborted) break;
      this.emit({ type: "turn_start" });
      this.emit({
        type: "message_start",
        message: { role: "assistant", content: [{ type: "text", text: "" }], stopReason: "pending" },
      });
      this.emit({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: this.options.text ?? DEFAULT_TEXT }],
          stopReason: "stop",
        },
      });
      this.lastAssistantText = this.options.text ?? DEFAULT_TEXT;
      this.usage.costUsd += this.options.costPerTurn ?? 0.25;
      this.usage.tokens += this.options.tokensPerTurn ?? 1000;
      this.usage.turns += 1;
      this.usage.toolCalls += this.options.toolCallsPerTurn ?? 1;
      this.emit({
        type: "tool_execution_end",
        toolCallId: `call-${index}`,
        toolName: "read",
        result: { content: [] },
        isError: false,
        durationMs: 1,
      });
      this.emit({ type: "turn_end", message: { role: "assistant", content: [] }, toolResults: [] });
      await this.delay();
    }

    this.running = false;
    this.emit({ type: "agent_end", messages: [], willRetry: Boolean(this.options.willRetry) && !this.aborted });
    if (this.options.willRetry && !this.aborted) {
      // Pi would continue on its own; a correct orchestrator must stop instead.
      await this.delay();
    }
    this.emit({ type: "agent_settled", aborted: this.aborted });
  }
}

function main(): void {
  const peer = new StubPeer(readOptions(), readSessionId(process.argv.slice(2)));
  peer.start();
}

const isEntryPoint = process.argv[1] !== undefined && process.argv[1].endsWith("stub-pi.js");
if (isEntryPoint) {
  main();
}
