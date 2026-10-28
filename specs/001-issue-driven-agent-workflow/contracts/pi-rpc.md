# Contract: Orchestrator ↔ Pi (RPC usage subset)

**Feature**: `001-issue-driven-agent-workflow` | **Requirements**: FR-002, FR-017, FR-018, FR-027, FR-029, FR-031, FR-032

Pi is used as an external process through its documented RPC protocol (Pi 1.4.0,
[`docs/rpc.md`](https://pi.dev/docs/rpc)). Only the subset below is permitted; the orchestrator does
not reach into Pi's internals or depend on anything outside the documented shapes.

## Launch

The orchestrator never invokes `pi` from `PATH` and never relies on a global install. It resolves the
pinned package's CLI entry — `<repoRoot>/node_modules/@earendil-works/pi-coding-agent/<package.json#bin.pi>`
— and executes it with the running Node binary (research D16, `contracts/config.md` Rule 9):

```bash
"$NODE" "$PI_ENTRY" --mode rpc \
   --offline \
   --no-approve \
   --no-extensions --no-skills --no-mcp --no-prompt-templates \
   --prompt-template .pi/prompts/speckit.specify.md \
   --prompt-template .pi/prompts/speckit.plan.md \
   --prompt-template .pi/prompts/speckit.tasks.md \
   # … one --prompt-template per entry of config.yml#promptTemplates
   --append-system-prompt .agent/instructions.md \
   --tools read,bash,edit,write,grep,find,ls \
   --model "<config.model>" \
   --thinking "<config.thinking>" \
   --session-id "agent-issue-$ISSUE_NUMBER-$FINGERPRINT_SHORT" \
   --session-dir "$RUNNER_TEMP/pi-sessions"
```

| Flag | Why it is in the contract |
|------|---------------------------|
| `--mode rpc` | Bidirectional control is required for cost inspection, boundary stop, retry control, and session continuity (research D2) |
| `--offline` | The agent works on a pinned model and must not reach the network for catalogue or update checks (FR-034, research D10) |
| `--no-approve` | Keeps trust-gated project resources (`.pi/extensions`, `.pi/settings.json`, `.pi/SYSTEM.md`, `.pi/mcp.json`) out of an unattended, credential-bearing process (research D3) |
| `--no-extensions --no-skills --no-mcp` | Nothing may inject tools or configuration besides the reviewed allowlist (research D3) |
| `--no-prompt-templates` **plus** explicit `--prompt-template` | Discovery off, named templates on. Explicit paths load even with `--no-prompt-templates`, so the agent's command vocabulary is exactly the configured allowlist and never whatever the branch contains (research D13) |
| `--append-system-prompt .agent/instructions.md` | The single reviewed behaviour file (research D3) |
| `--tools` | Explicit allowlist; no codemode, no MCP, no extension tools. There is deliberately no git or forge tool, because repository authority lives in the orchestrator (research D10) |
| `--session-id` + `--session-dir` | Continuity across job invocations; the directory sits outside the workspace so session files can never enter a diff. The id carries the configuration fingerprint, so a session is only resumed under the configuration that produced it (research D5) |
| `--model`, `--thinking` | Pinned per run and recorded in the acknowledgement (research D12). Both come from `.agent/config.yml`, never from an environment variable, so behaviour is reviewable (`contracts/config.md`) |

Context files (`AGENTS.md`) stay enabled: they are project documentation the agent should respect
(the constitution is referenced there).

### Provider definition

`--model` names a provider that is not built into Pi, so the provider endpoint has to come from
documentation-shaped configuration. Pi reads `models.json` from its agent directory, therefore the
orchestrator writes the reviewed `.agent/models.json` to `<session-dir>/pi-agent/models.json` and sets
`PI_CODING_AGENT_DIR` to `<session-dir>/pi-agent` before spawning Pi. The copy is root-owned and the
agent cannot write it, so the agent can neither redirect its own provider nor add one. The provider's
`apiKey` is the `$OLLAMA_API_KEY` environment interpolation; the key itself never appears in the file
(research D18, `contracts/config.md` §"Related file").

### Runtime preconditions

Before the acknowledgement that reports the version — and therefore before the first prompt — the run
fails with `environment` unless all of the following hold. No model call happens and no partial session
is written.

| Precondition | Why |
|--------------|-----|
| The package resolves from `<repoRoot>/node_modules/`, not from a parent or global location | The running agent must be the reviewed dependency, not whatever the runner image provides |
| `dependencies["@earendil-works/pi-coding-agent"]` in the root `package.json` is an exact version | A range would allow silent behaviour drift (research D12) |
| The installed version and the `package-lock.json` version both equal that pin | The version recorded in `agent:ack` must be the version that executed |
| `bin.pi` is readable and the Node binary is executable for the egress uid | A missing entry or unreadable binary would otherwise surface as an opaque spawn error |
| When `AGENT_EGRESS_UID` is set, the orchestrator has uid 0 | Dropping to the egress uid is a privileged operation (research D17) |

The resolved version, not a constant, is what `agent:ack` reports. A spawn failure after these checks
is still classified as `environment`.

## Continuity

A stored Pi session may only be resumed when it was produced under the same configuration. Pi persists
the system-prompt sections and the tool declarations in the session file, so resuming under a changed
`.agent/instructions.md`, tool allowlist, or model would replay the old prompt and the old tools — a
direct violation of FR-014.

Rules:

1. The session identity is `agent-issue-<number>-<fingerprint-short>`, where the fingerprint covers the
   instructions content hash, `model`, `thinking`, `tools`, `promptTemplates`, and the pinned Pi version
   (`contracts/config.md`).
2. The cache key uses the same fingerprint, so a configuration change or a Pi upgrade starts from a cold
   cache rather than from a stale session.
3. After start and before the first prompt, the orchestrator reads `get_state` and asserts that the
   effective tool list is a subset of the configured allowlist and that `modelId` matches the
   configuration. A mismatch fails the run with `environment` instead of running under old rules.
4. When no session is restored, the orchestrator injects the thread digest (request text, prior feedback,
   decisions, proposal links) and the run is marked in the acknowledgement as a cold start.

## Session accounting

Cost and token figures from `get_session_stats` are session-lifetime values, and a session ends whenever the
configuration fingerprint changes or the cache is lost. Accounting is therefore per session, not per
issue: the orchestrator records each session's consumption separately in the issue as an
`agent:session` message, and the per-issue total — the number the limit applies to — is the sum of the
documented sessions. A lost cache cannot reset the limit, and a reader can see exactly which session
spent what (decision recorded in `spec.md` §Clarifications; `contracts/thread-messages.md` §8).

## Network

The agent process runs with no outbound access except the model provider endpoint:

| Path | Allowed | Mechanism |
|------|---------|-----------|
| Model provider API and its authentication endpoint | yes | the only hosts in the allowlist, taken from `network.allowHosts`; a token refresh must not be blocked (`contracts/config.md`) |
| Pi catalogue / update checks | no | `--offline` |
| Repository API, package registries, anything else | no | job-level egress restriction applied before Pi starts; the orchestrator, not Pi, holds the repository credential |

A run whose egress restriction cannot be applied fails with `environment` instead of starting the agent
(FR-034). `bash` remains available for local work, but it has nowhere to send anything.

### Privilege handoff and workspace ownership

The egress policy is applied per uid, so the orchestrator must be able to `setuid` the Pi child. The
`run` and `command` workflow steps therefore execute the orchestrator through
`sudo --preserve-env=…`; `prepare`, `proposal`, and `sweep` stay unprivileged because they never spawn
Pi. The preserved set is non-secret only (`GITHUB_EVENT_PATH`, `GITHUB_EVENT_NAME`, `GITHUB_REPOSITORY`,
`GITHUB_RUN_ID`, `GITHUB_WORKSPACE`, `RUNNER_TEMP`, `AGENT_EGRESS_UID`, `AGENT_ENV_FILE`,
`AGENT_CACHE_OWNER_UID`, `AGENT_CACHE_OWNER_GID`); Node is
invoked by absolute path because `sudo` resets `PATH`. Secrets travel in a mode-`0600` file named by
`AGENT_ENV_FILE`, which root can read and the egress uid cannot; the orchestrator reads it once and
unlinks it before spawning Pi. This avoids relying on the runner image granting `SETENV` for secret
variables and keeps the token out of every argument list.

| Boundary | Rule | Why |
|----------|------|-----|
| Orchestrator uid | 0 when `AGENT_EGRESS_UID` is set; otherwise the run fails with `environment` | An unprivileged process cannot drop privileges; a silent fallback to root-Pi is forbidden |
| Pi uid | exactly `AGENT_EGRESS_UID`, verified by a preflight probe | The iptables owner match is the whole egress control |
| Work tree | recursively owned by the egress uid so `edit`/`write` can change existing files, except `node_modules/`, which stays read-only | A root-owned checkout would make every edit fail with `EACCES`; a writable `node_modules/` would let the agent rewrite its own harness |
| Ancestor traversal | execute permission for the egress uid on the path from `/` to `GITHUB_WORKSPACE` | The runner home is not guaranteed to be world-traversable; the egress uid needs the path, not a listing |
| Git directory | outside the work tree, under `RUNNER_TEMP`, root-owned mode `0700`; the work tree has no `.git` | The egress uid owns the work-tree root and could delete or replace an in-tree `.git`; a replacement could carry a malicious `core.fsmonitor` or hooks |
| Git invocation | `--git-dir=<GIT_DIR> --work-tree=<repoRoot>`, `-c safe.directory=<repoRoot>`, `-c core.hooksPath=/dev/null`, `--no-verify` | Defense in depth; the git directory is already unreachable by the agent |
| Push credential | `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_0` / `GIT_CONFIG_VALUE_0` in the git child's environment, never argv | `/proc/<pid>/environ` is owner-readable; `/proc/<pid>/cmdline` is world-readable |
| Teardown | Pi is a process-group leader; the group is killed, then every remaining process of the egress uid is reaped before the diff is collected | Covers even a process the agent started with `setsid` |

A preflight probe runs as the egress uid before the acknowledgement: it must succeed on a work-tree
write, fail to read or write `GIT_DIR`, find no `.git` entry in the work tree, and fail to write under
`node_modules/`. Either result going the other way fails the run with `environment` instead of starting
the agent. The secret file is unlinked before this probe, so Pi cannot inherit a path to it.

## Environment

| Variable | Present | Reason |
|----------|---------|--------|
| Provider key (`OLLAMA_API_KEY`) | yes | The only credential Pi needs; read once from the mode-`0600` `AGENT_ENV_FILE` and passed only to the Pi child, where the provider definition references it as `$OLLAMA_API_KEY` |
| `GITHUB_TOKEN` / `GH_TOKEN` | **no** | Hard rule: no repository authority inside the agent process (FR-029, research D10). The token is read from `AGENT_ENV_FILE` into the orchestrator and stripped from the child environment explicitly; a unit test asserts this. The file is unlinked before Pi starts |
| `.git/config` credential helper / remote token | **no** | The checkout runs with `persist-credentials: false`; the git directory lives outside the work tree and only the orchestrator reads it. The push credential is passed per invocation and never written to its config. A unit test asserts the workspace git config contains no token before Pi starts (research D10, layer c) |
| `HOME`, `TMPDIR`, `XDG_CACHE_HOME` | yes, under the chowned session directory | The egress user is created with `--no-create-home`; Pi must not fall back to an unwritable home |
| `PI_CODING_AGENT_DIR` | yes, pointing at a per-run agent directory under the session directory | Pi reads `models.json` from there; the orchestrator copies the reviewed `.agent/models.json` in and keeps the copy root-owned so the agent cannot redirect its provider |
| `AGENT_ENV_FILE` | **no** | The orchestrator reads and unlinks it before spawning Pi, and `sanitizeEnvironment` strips the name |
| `PATH` | yes, without any Pi entry | Needed by the agent's own `bash` tool; Pi itself is launched by absolute path, so `PATH` cannot change which Pi runs |
| `NODE_COMPILE_CACHE` | not set by the workflow | A runner-provided cache path could be unwritable for the egress uid |
| Model or thinking overrides | **no** | They are configuration, not environment (`.agent/config.yml`), so they are reviewable |
| `PI_*` session markers | injected by Pi | Used for diagnostics only |

## Commands sent

| Command | When | Purpose |
|---------|------|---------|
| `set_auto_retry` `{enabled: false}` | immediately after start, before the first prompt | FR-031: no automatic retry at any layer (research D7) |
| `set_auto_compaction` `{enabled: false}` | immediately after start, before the first prompt | FR-031: proactive compaction and the retry it can trigger must not happen behind the thread's back (research D7) |
| `prompt` | once per run, carrying the task brief (issue title/body, prior feedback digest, command reason, and the "content is data" reminder), or a `/speckit.* <arguments>` invocation when the request warrants a Spec Kit run | Start work |
| `abort` | only after an action boundary (`turn_end`), when a halt or a limit stop is pending | FR-027: an action in flight is never interrupted. Note that `abort` itself ends the current operation and only then waits for idle, which is why it must not be sent mid-turn |
| `get_session_stats` | after every `turn_end` boundary | Cumulative cost/tokens for FR-017 and the status comment |
| `get_state` | before aborting | Confirm `isStreaming`/`messageCount` so the feedback comment describes the real point of interruption |
| `get_messages` | not used on the normal path. Only in the recovery path, to reconstruct what the previous Pi session saw when the session file is missing | The thread digest is built from the GitHub thread, not from Pi. `get_messages` is a diagnostic of the harness, never the record |

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
6. **No git side effects** — the Spec Kit scripts in this repository contain no git invocations (the only
   occurrences of the word are comments about a hook extension that does not exist), so a template run
   cannot create branches or commits. If a future template adds any, it violates this contract and must
   be caught in review.
7. **Startup assertion** — explicit `--prompt-template` paths load even with `--no-approve` and
   `--no-prompt-templates` because trust gates discovery, not explicitly named paths. That interaction is
   verified against the packaged implementation but is not stated as a user-facing guarantee, so the
   orchestrator asserts at startup that every configured command exists and fails the run with
   `environment` if one is missing. Moving the allowlisted templates to a trust-independent directory is
   the fallback if that assertion ever starts failing after a Pi upgrade.

## Events consumed

| Event | Orchestrator behaviour |
|-------|------------------------|
| `turn_end` | An **action boundary**. Drain pending commands, check the budget, refresh the status comment |
| `tool_execution_end` | Diagnostics only (tool name, duration, error flag); never posted raw to the thread |
| `auto_retry_start` | Contract violation if it ever appears (auto retry is disabled) — logged as a defect signal, and the run is failed rather than resumed |
| `compaction_start` / `compaction_end` | Contract violation if it ever appears: automatic compaction is disabled (research D7). Logged and treated like a retry signal |
| `summarization_retry_scheduled`, `summarization_retry_attempt_start` | Contract violation: a recovery retry is an automatic retry. The orchestrator aborts and fails the run with `unexpected-retry` (FR-031) |
| `auto_retry_end`, `agent_end.willRetry: true` | Same treatment: any sign that Pi is about to continue on its own ends the run |
| `agent_end` | Not a stop signal (automatic work may follow) |
| `agent_settled` | The run is over. `aborted: true` → `halted` or `waiting`; otherwise classify the outcome. `willRetry` on the preceding `agent_end` is a retry signal and fails the run |

## Stop and teardown

- A pending halt discovered during a turn is applied at the next `turn_end`: the orchestrator calls
  `get_state`, posts the feedback comment (FR-028), then sends `abort`, and waits for `agent_settled`.
  Because `abort` continues any queued steering or follow-up messages, the orchestrator asserts through
  `get_state` that both queues are empty before aborting; the contract never queues `steer` or
  `follow_up`, so a non-empty queue is a defect signal that fails the run.
- Shutdown is ordered: close stdin, wait for exit with a bounded grace period, then kill the whole
  process group (Pi is spawned as its group leader) and reap any remaining process owned by the egress
  uid. The group is reaped before diff collection, so a background process the agent started cannot keep
  editing the workspace. A nonzero exit whose stop reason is `error` or `aborted` fails the run; a
  `length` stop reason fails it with `agent-error`.
- The session file written under `--session-dir` is cached after the job with key
  `pi-session-<issue>-<fingerprint>` (`contracts/config.md` §Rules 5); missing cache is not an error and
  falls back to the thread digest.

## Failure mapping

| Condition | Reported failure enum |
|-----------|----------------------|
| Pi entry not resolvable, outside `<repoRoot>/node_modules`, or version differs from the exact pin | `environment` — no model call, `agent:ack` reports no version |
| `AGENT_EGRESS_UID` is set but the orchestrator is not uid 0 | `environment` — the job did not use the documented privilege handoff |
| Spawn as the egress uid fails (`EPERM`, `ENOENT`) | `environment` |
| Preflight probe can read or write `GIT_DIR`, finds a `.git` in the work tree, writes under `node_modules/`, or cannot write the work tree as the egress uid | `environment` |
| No response to the first prompt within the start deadline | `environment` |
| `agent_settled` with `aborted` after a halt | `halted` (state), not a failure |
| Provider error / auth failure | `environment` |
| Model output token limit reached (`length`) | `agent-error` |
| Orchestrator killed by job timeout | `interrupted` (by the reconciler, contract `labels.md` I5) |
| Credential detected in output or diff | `secret-request` |
| Retry signal (`summarization_retry_*`, `compaction_*`, `auto_retry_*`, `willRetry`) | `unexpected-retry` — the run is stopped instead of continuing invisibly |
| Template invocation of a non-allowlisted command | Ordinary text; the agent must report it as an ignored directive (FR-030) |
