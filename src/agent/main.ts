import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import { AgentError, errorMessage, isAgentError } from "./errors.js";
import { detectMode, parseReviewOutcome, type EventPayload, type WorkflowMode } from "./events.js";
import { RestGitHubClient } from "./github.js";
import { RpcPiRunner } from "./pi.js";
import { handleReview } from "./review.js";
import { handleWork } from "./session.js";
import { GitWorkspace } from "./workspace.js";

interface GitHubEvent {
  repository?: {
    full_name?: string;
    name?: string;
    owner?: { login?: string };
    default_branch?: string;
  };
  [key: string]: unknown;
}

function readEvent(): { eventName: string; payload: EventPayload & GitHubEvent } {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    throw new AgentError("environment", "GITHUB_EVENT_PATH is not set");
  }
  const eventName = process.env.GITHUB_EVENT_NAME;
  if (!eventName) {
    throw new AgentError("environment", "GITHUB_EVENT_NAME is not set");
  }
  let payload: GitHubEvent;
  try {
    payload = JSON.parse(readFileSync(eventPath, "utf8")) as GitHubEvent;
  } catch (error) {
    throw new AgentError("environment", `cannot read event payload: ${errorMessage(error)}`);
  }
  return { eventName, payload: payload as EventPayload & GitHubEvent };
}

function resolveRepository(payload: GitHubEvent): { owner: string; repo: string } {
  const fullName =
    payload.repository?.full_name ??
    process.env.GITHUB_REPOSITORY ??
    "";
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) {
    throw new AgentError("environment", "cannot determine repository owner and name");
  }
  return { owner, repo };
}

function resolveMode(argvMode: string | undefined, eventName: string, payload: EventPayload): WorkflowMode {
  if (argvMode === "run" || argvMode === "resume" || argvMode === "review") {
    return argvMode;
  }
  const detected = detectMode(eventName, payload);
  if (!detected) {
    throw new AgentError("trigger", `unsupported event ${eventName}`);
  }
  return detected;
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const argvMode = process.argv[2];
  const { eventName, payload } = readEvent();
  const mode = resolveMode(argvMode, eventName, payload);
  const { owner, repo } = resolveRepository(payload);
  const runId = process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`;
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new AgentError("environment", "GITHUB_TOKEN is not set");
  }

  const loaded = loadConfig(repoRoot);
  const client = new RestGitHubClient({ token });
  const workRoot = process.env.RUNNER_TEMP
    ? path.join(process.env.RUNNER_TEMP, "agentic-playground")
    : path.join(repoRoot, ".agent-state", "work");
  mkdirSync(workRoot, { recursive: true });

  if (mode === "review") {
    const outcome = parseReviewOutcome(eventName, payload);
    if (!outcome) {
      console.log("review event did not reference an issue; nothing to do");
      return;
    }
    await handleReview({
      client,
      owner,
      repo,
      outcome,
      now: new Date().toISOString(),
    });
    return;
  }

  const deps = {
    client,
    pi: new RpcPiRunner(repoRoot),
    workspaceFactory: (root: string) => new GitWorkspace(root),
    loaded,
    repoRoot,
    workRoot,
    token,
    owner,
    repo,
    runId,
    now: () => new Date(),
    log: (line: string) => console.log(line),
    secrets: [token, process.env.OLLAMA_API_KEY ?? ""].filter((value) => value.length > 0),
  };

  await handleWork({
    deps,
    eventName,
    payload,
  });
}

main().catch((error: unknown) => {
  if (isAgentError(error)) {
    console.error(`agent failed [${error.code}]: ${error.message}`);
  } else {
    console.error(`agent failed: ${errorMessage(error)}`);
  }
  process.exitCode = 1;
});
