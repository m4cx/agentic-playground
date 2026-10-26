# Contract: Orchestrator ↔ Pi (RPC usage subset)

**Feature**: `001-issue-driven-agent-workflow` | **Requirements**: FR-002, FR-017, FR-018, FR-027, FR-029, FR-031, FR-032

Pi is used as an external process through its documented RPC protocol (Pi 1.4.0,
[`docs/rpc.md`](https://pi.dev/docs/rpc)). Only the subset below is permitted; the orchestrator does
not reach into Pi's internals or depend on anything outside the documented shapes.

## Launch

```bash
pi --mode rpc \
   --no-approve \
   --no-extensions --no-skills --no-mcp --no-prompt-templates \
   --prompt-template .pi/prompts/speckit.specify.md \
   --prompt-template .pi/prompts/speckit.plan.md \
   --prompt-template .pi/prompts/speckit.tasks.md \
   # … one --prompt-template per entry of config.yml#promptTemplates
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
| `--no-extensions --no-skills --no-mcp` | Nothing may inject tools or configuration besides the reviewed allowlist (research D3) |
| `--no-prompt-templates` **plus** explicit `--prompt-template` | Discovery off, named templates on. Explicit paths load even with `--no-prompt-templates`, so the agent's command vocabulary is exactly the configured allowlist and never whatever the branch contains (research D13) |
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
| `.git/config` credential helper / remote token | **no** | The checkout runs with `persist-credentials: false`; the orchestrator adds a per-job credential only for its own push and removes it afterwards. A unit test asserts the workspace git config contains no token before Pi starts (research D10, layer c) |
| `PI_*` session markers | injected by Pi | Used for diagnostics only |

## Commands sent

| Command | When | Purpose |
|---------|------|---------|
| `set_auto_retry` `{enabled: false}` | immediately after start, before the first prompt | FR-031: no automatic retry at any layer (research D7) |
| `prompt` | once per run, carrying the task brief (issue title/body, prior feedback digest, command reason, and the "content is data" reminder), or a `/speckit.* <arguments>` invocation when the request warrants a Spec Kit run | Start work |
| `abort` | only at an action boundary, when a halt or a limit stop is pending | FR-027: never mid-action |
| `get_session_stats` | after every `turn_end` boundary | Cumulative cost/tokens for FR-017 and the status comment |
| `get_state` | before aborting | Confirm `isStreaming`/`messageCount` so the feedback comment describes the real point of interruption |
| `get_messages` | only in the recovery path when no session was restored | Build the thread digest instead of trusting the cache |

`steer` and `follow_up` are deliberately **not** used: a halt ends work, it does not redirect it, and
redirecting an unattended agent from issue text would widen the injection surface.

## Prompt templates (Spec Kit)

Because `--prompt-template` is supplied per allowlist entry, `prompt` may carry a slash command:

```text
/speckit.plan <feature argument>
```

Pi expands the template (including `$ARGUMENTS` / `${1:-default}`) before the text enters the agent.
Rules:

1. **Allowlist only** — the orchestrator passes exactly the paths listed in
   `config.yml#promptTemplates`. A slash command naming a template that was not loaded is not expanded
   and is treated as ordinary text.
2. **Trusted ref** — templates resolve against the checkout of the trusted default branch, never
   against a branch the agent created.
3. **Interactive templates become thread steps** — when a template's workflow needs a human decision
   (`/speckit.clarify`, `[NEEDS CLARIFICATION]`, hook prompts), the run enters `waiting`, posts the
   question, and resumes on `/agent continue`. The orchestrator never fabricates an answer.
4. **Artifacts are English** — anything a template causes to be written (`specs/**`) is committed
   content and falls under the constitution (FR-019).
5. **Scope guard** — `.agent/instructions.md` restricts template use to issues large enough to
   justify a specification; small fixes are made directly. The orchestrator reports which templates a
   run used in its `agent:result` comment, so the choice is auditable.
6. **No git side effects** — the Spec Kit scripts in this repository contain no git invocations, so a
   template run cannot create branches or commits. If a future template adds any, it violates this
   contract and must be caught in review.

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
| Template invocation of a non-allowlisted command | Ordinary text; the agent must report it as an ignored directive (FR-030) |
