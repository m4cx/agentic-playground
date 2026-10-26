# Contract: Orchestrator ↔ Pi (RPC usage subset)

**Feature**: `001-issue-driven-agent-workflow` | **Requirements**: FR-002, FR-017, FR-018, FR-027, FR-029, FR-031, FR-032

Pi is used as an external process through its documented RPC protocol (Pi 1.4.0,
[`docs/rpc.md`](https://pi.dev/docs/rpc)). Only the subset below is permitted; the orchestrator does
not reach into Pi's internals or depend on anything outside the documented shapes.

## Launch

```bash
pi --mode rpc \
   --no-approve \
   --no-extensions --no-skills --no-prompt-templates --no-mcp \
   --append-system-prompt .agent/instructions.md \
   --tools read,bash,edit,write,grep,find,ls \
   --model "$AGENT_MODEL" \
   --thinking "$AGENT_THINKING" \
   --session-id "agent-issue-$ISSUE_NUMBER" \
   --session-dir "$RUNNER_TEMP/pi-sessions"
```

| Flag | Why it is in the contract |
|------|---------------------------|
| `--mode rpc` | Bidirectional control is required for cost inspection, boundary stop, retry control, and session continuity (research D2) |
| `--no-approve` | Keeps trust-gated project resources (`.pi/extensions`, `.pi/settings.json`, `.pi/SYSTEM.md`, `.pi/mcp.json`) out of an unattended, credential-bearing process (research D3) |
| `--no-extensions --no-skills --no-prompt-templates --no-mcp` | Nothing may inject tools or instructions besides the reviewed allowlist; Spec Kit prompt templates in `.pi/prompts` are irrelevant to the remote agent |
| `--append-system-prompt .agent/instructions.md` | The single reviewed behaviour file (research D3) |
| `--tools` | Explicit allowlist; no codemode, no MCP, no extension tools. There is deliberately no git or forge tool, because repository authority lives in the orchestrator (research D10) |
| `--session-id` + `--session-dir` | Continuity across job invocations; the directory sits outside the workspace so session files can never enter a diff (research D5) |
| `--model`, `--thinking` | Pinned per run and recorded in the acknowledgement (research D12) |

Context files (`AGENTS.md`) stay enabled: they are project documentation the agent should respect
(the constitution is referenced there).

## Environment

| Variable | Present | Reason |
|----------|---------|--------|
| Provider key (e.g. `ANTHROPIC_API_KEY`) | yes | The only credential Pi needs |
| `GITHUB_TOKEN` / `GH_TOKEN` | **no** | Hard rule: no repository authority inside the agent process (FR-029, research D10). The orchestrator strips it from the child environment explicitly, and a unit test asserts this |
| `PI_*` session markers | injected by Pi | Used for diagnostics only |

## Commands sent

| Command | When | Purpose |
|---------|------|---------|
| `set_auto_retry` `{enabled: false}` | immediately after start, before the first prompt | FR-031: no automatic retry at any layer (research D7) |
| `prompt` | once per run, carrying the task brief (issue title/body, prior feedback digest, command reason, and the "content is data" reminder) | Start work |
| `abort` | only at an action boundary, when a halt or a limit stop is pending | FR-027: never mid-action |
| `get_session_stats` | after every `turn_end` boundary | Cumulative cost/tokens for FR-017 and the status comment |
| `get_state` | before aborting | Confirm `isStreaming`/`messageCount` so the feedback comment describes the real point of interruption |
| `get_messages` | only in the recovery path when no session was restored | Build the thread digest instead of trusting the cache |

`steer` and `follow_up` are deliberately **not** used: a halt ends work, it does not redirect it, and
redirecting an unattended agent from issue text would widen the injection surface.

## Events consumed

| Event | Orchestrator behaviour |
|-------|------------------------|
| `turn_end` | An **action boundary**. Drain pending commands, check the budget, refresh the status comment |
| `tool_execution_end` | Diagnostics only (tool name, duration, error flag); never posted raw to the thread |
| `auto_retry_start` | Contract violation if it ever appears (auto retry is disabled) — logged as a defect signal, and the run is failed rather than resumed |
| `compaction_start` / `compaction_end` | Logged; compaction is allowed but its cost counts toward the budget |
| `agent_end` | Not a stop signal (automatic work may follow) |
| `agent_settled` | The run is over. `aborted: true` → `halted` or `waiting`; otherwise classify the outcome |

## Stop and teardown

- A pending halt discovered during a turn is applied at the next `turn_end`: the orchestrator calls
  `get_state`, posts the feedback comment (FR-028), then sends `abort`, and waits for `agent_settled`.
- Shutdown is ordered: close stdin, wait for exit with a bounded grace period, then kill. A nonzero
  exit whose stop reason is `error` or `aborted` fails the run; a `length` stop reason fails it with
  `agent-error`.
- The session file written under `--session-dir` is cached after the job with key
  `pi-session-<issue>`; missing cache is not an error and falls back to the thread digest.

## Failure mapping

| Condition | Reported failure enum |
|-----------|----------------------|
| No response to the first prompt within the start deadline | `environment` |
| `agent_settled` with `aborted` after a halt | `halted` (state), not a failure |
| Provider error / auth failure | `environment` |
| Model output token limit reached (`length`) | `agent-error` |
| Orchestrator killed by job timeout | `interrupted` (by the reconciler, contract `labels.md` I5) |
| Credential detected in output or diff | `secret-request` |
