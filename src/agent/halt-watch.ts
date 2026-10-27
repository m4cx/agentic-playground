/**
 * Command polling while a run is active (FR-027).
 *
 * Commands are queued in arrival order and only exposed to the boundary loop. They
 * never interrupt an action in flight, and nothing here steers or redirects the
 * agent — a halt ends work, it does not rewrite it.
 */

import { parseCommand } from "./commands.js";

export interface WatchComment {
  id: number;
  body: string | null;
  user: { login: string } | null;
  created_at: string;
}

export interface QueuedCommand {
  commandId: number;
  word: string;
  kind: "decision" | "informational" | "unknown";
  reason: string;
  actor: string;
  at: string;
}

export interface HaltWatchOptions {
  fetchComments: () => Promise<WatchComment[]>;
  isPermitted: (login: string) => Promise<boolean>;
  since: string;
  seenCommandIds?: Iterable<number>;
  onDenied?: (command: QueuedCommand) => void;
}

export class HaltWatch {
  private readonly options: HaltWatchOptions;
  private readonly seen: Set<number>;
  private queue: QueuedCommand[] = [];
  private informational: QueuedCommand[] = [];

  constructor(options: HaltWatchOptions) {
    this.options = options;
    this.seen = new Set<number>(options.seenCommandIds ?? []);
  }

  /** Fetch new comments and queue the commands among them that were not seen yet. */
  async poll(): Promise<QueuedCommand[]> {
    const comments = await this.options.fetchComments();
    const fresh = comments
      .filter((comment) => !this.seen.has(comment.id))
      .filter((comment) => comment.created_at >= this.options.since)
      .sort((left, right) => (left.created_at < right.created_at ? -1 : left.created_at > right.created_at ? 1 : left.id - right.id));

    const added: QueuedCommand[] = [];
    for (const comment of fresh) {
      this.seen.add(comment.id);
      const parsed = parseCommand(comment.body);
      if (parsed === null) continue;
      const actor = comment.user?.login ?? "";
      const queued: QueuedCommand = {
        commandId: comment.id,
        word: parsed.word,
        kind: parsed.kind,
        reason: parsed.reason,
        actor,
        at: comment.created_at,
      };
      if (parsed.kind === "unknown") {
        // Unknown words are answered by the normal command path, never applied.
        this.informational.push(queued);
        continue;
      }
      if (parsed.kind === "informational") {
        this.informational.push(queued);
        continue;
      }
      const permitted = await this.options.isPermitted(actor);
      if (!permitted) {
        this.options.onDenied?.(queued);
        continue;
      }
      this.queue.push(queued);
      added.push(queued);
    }
    return added;
  }

  /** Commands applied at the next boundary, in arrival order. */
  drain(): QueuedCommand[] {
    const drained = this.queue;
    this.queue = [];
    return drained;
  }

  /** Informational commands (status, help, unknown words) that never change state. */
  drainInformational(): QueuedCommand[] {
    const drained = this.informational;
    this.informational = [];
    return drained;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  peek(): readonly QueuedCommand[] {
    return this.queue;
  }

  markSeen(commentIds: Iterable<number>): void {
    for (const id of commentIds) this.seen.add(id);
  }
}
