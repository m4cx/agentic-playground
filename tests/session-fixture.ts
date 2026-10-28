import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "../src/agent/config.js";
import type { TriggerPayload } from "../src/agent/trigger.js";
import type { SessionDeps } from "../src/agent/session.js";
import type { PiRunner } from "../src/agent/pi.js";
import type { WorkspaceLike } from "../src/agent/workspace.js";
import { createSession, createStateRecord, type SessionState } from "../src/agent/state.js";
import { renderStateComment } from "../src/agent/messages.js";
import { FakeGitHub } from "./fake-github.js";
import { FakeWorkspace } from "./fake-workspace.js";
import { FakePi } from "./fake-rpc.js";
import { readFileSync } from "node:fs";

export const trigger = {
  kind: "label" as const,
  actor: "maintainer",
  permission: "write" as const,
  at: "2026-10-28T10:00:00Z",
  commentId: null,
  commandText: null,
  labelName: "agent:run",
};

export function readEvent(name: string): TriggerPayload {
  const raw = readFileSync(path.join(process.cwd(), "tests", "fixtures", "events", name), "utf8");
  return JSON.parse(raw) as TriggerPayload;
}

export function seedSession(
  github: FakeGitHub,
  state: SessionState = "finished",
  withRun = true,
): ReturnType<typeof createStateRecord> {
  const session = createSession({
    issueNumber: github.issue.number,
    title: github.issue.title,
    trigger,
    now: "2026-10-28T10:00:00Z",
    slugMaxLength: 50,
    fingerprint: loadConfig(process.cwd()).fingerprint,
    requestVersion: "sha256:seed",
  });
  session.state = state;
  session.pullRequestNumber = state === "working" ? null : 7;
  session.headSha = state === "accepted" ? null : "head-sha";
  const record = createStateRecord(session, "run-seed");
  if (withRun) {
    record.session.runs.push({
      id: "run-seed",
      trigger,
      startedAt: "2026-10-28T10:00:00Z",
      endedAt: "2026-10-28T10:01:00Z",
      outcome: state === "finished" ? "finished" : state === "waiting" ? "waiting" : "failed",
      piSessionId: session.piSessionId,
      commitShas: ["seed-sha"],
      changedPaths: ["src/file.ts"],
      verification: ["seed"],
      failureReason: null,
      nextAction: null,
    });
    record.lastRun = record.session.runs[0] ?? null;
  }
  record.sessionCommentId = 5000;
  github.comments.push({
    id: 5000,
    body: renderStateComment(record),
    user: { login: "github-actions[bot]", type: "Bot" },
    created_at: "2026-10-28T10:00:00Z",
  });
  return record;
}

export function makeDeps(input: {
  github: FakeGitHub;
  pi: FakePi | PiRunner;
  workspace: FakeWorkspace | WorkspaceLike;
  runId: string;
  now?: string;
  workRoot?: string;
  secrets?: string[];
}): { deps: SessionDeps; cleanup: () => void } {
  const workRoot = input.workRoot ?? mkdtempSync(path.join(tmpdir(), "agentic-work-"));
  const cleanup = input.workRoot ? () => undefined : () => rmSync(workRoot, { recursive: true, force: true });
  return {
    deps: {
      client: input.github,
      pi: input.pi,
      workspaceFactory: () => input.workspace,
      loaded: loadConfig(process.cwd()),
      repoRoot: process.cwd(),
      workRoot,
      token: "token-value",
      owner: "owner",
      repo: "repo",
      runId: input.runId,
      now: () => new Date(input.now ?? "2026-10-28T10:05:00Z"),
      log: () => undefined,
      secrets: input.secrets ?? [],
    },
    cleanup,
  };
}
