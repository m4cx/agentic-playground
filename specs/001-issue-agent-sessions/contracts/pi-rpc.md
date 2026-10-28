# Contract: Orchestrator ↔ Pi RPC

**Feature**: `001-issue-agent-sessions` | **Version**: 1

This contract fixes the Pi integration surface. It is implemented by `src/agent/pi.ts`,
`src/agent/pi-runtime.ts`, and `.github/scripts/agent-egress.sh`.

## Pinned runtime

- Package: `@earendil-works/pi-coding-agent`, exact version `1.4.0` in `package.json` and
  `package-lock.json`.
- Executable: resolved from the installed package (`node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js`)
  and started with the running Node binary. `PATH` and a globally installed `pi` are never consulted.
- The orchestrator asserts the installed package version before the first model call. A mismatch
  fails with `environment`.
- Node.js 22.19 or newer.

## Launch

```text
node <resolved-pi-cli> --mode rpc \
  --session-id issue-<n>-<fingerprint8> \
  --session-dir ${RUNNER_TEMP}/agentic-playground/sessions \
  --model <provider>/<model> \
  --thinking <level> \
  --tools read,bash,edit,write,grep,find,ls \
  --no-approve \
  --no-extensions \
  --no-mcp \
  --append-system-prompt <run-local>/.agent/instructions.md
```

- The instructions, config, and models files are materialized from the **current default-branch
  commit** into `<run-local>/.agent/` before the feature branch is checked out. Pi therefore cannot
  load a behaviour file that the branch under work has modified. A behaviour change takes effect only
  after a human merges it to the default branch and the next run starts.

- `--no-approve` prevents project-local trust-gated resources from loading. `AGENTS.md` still loads
  as ordinary context, which is acceptable; the standing instructions take precedence for this run.
- `--no-extensions` and `--no-mcp` keep executable repository configuration out of the unattended
  process. Prompt templates and skills are not needed.
- The tool list comes from `.agent/config.json` and is validated before launch.
- The model string must resolve in the run-local `models.json`; the provider key is supplied through
  the environment.
- `PI_CODING_AGENT_DIR` points at the run-local directory containing the reviewed `models.json` and
  no user configuration. It is populated from the default branch, never from the feature branch.

## Environment

The orchestrator builds the child environment explicitly:

| Variable | Included | Why |
|----------|----------|-----|
| `PATH` | minimal (`/usr/local/bin:/usr/bin:/bin`) | run node, git, npm inside the workspace |
| `HOME` | run-local writable home under the workspace | Pi, npm, and git caches without touching the runner's home |
| `PI_CODING_AGENT_DIR` | run-local | reviewed model configuration |
| `PI_CODING_AGENT_SESSION_DIR` | workspace cache | session continuity |
| `OLLAMA_API_KEY` | yes | model endpoint authentication |
| `PI_OFFLINE` | `0` | model access is required; egress rules restrict it |
| `CI` | `1` | deterministic tooling behavior |
| `GITHUB_TOKEN` | **no** | repository authority stays with the orchestrator |
| `ACTIONS_*`, `RUNNER_*` | **no** | not needed and may reveal job metadata |

The child runs as the `agent-egress` user, not the runner user. The orchestrator creates the run-local
home and the workspace cache directory, then gives the agent user ownership of the workspace and its
home so it can edit files and install packages.

## Session cache

- Cache path: `${RUNNER_TEMP}/agentic-playground/sessions`, restored by `actions/cache` in both
  agent workflows and shared across runs of the same issue.
- Cache key: `agent-session-<issue-number>-<fingerprint8>-<run-id>`.
- Restore keys: `agent-session-<issue-number>-<fingerprint8>-`.
- The cache is saved at the end of every run, including failed runs, so a later resume can reuse the
  conversation. A cache save failure is a warning, not a run failure.
- Cache entries are scoped to the repository. They never contain the GitHub token; the agent never
  receives it. Session content may contain issue text and file contents, so it is treated as
  repository-confidential and never uploaded as a public artifact.
- On a cache miss, the orchestrator starts a fresh Pi session seeded with the thread digest from
  `data-model.md` (issue, comments, prior result summaries, branch diff stat, conflicts).

## Fingerprint

```text
fingerprint8 = first 8 hex characters of SHA-256(
  instructions.md bytes ||
  config.json bytes ||
  models.json bytes ||
  model id ||
  sorted tool list ||
  pi version
)
```

A fingerprint change starts a new Pi session ID and a new cache namespace. The branch, slug, and
issue-session identity are unchanged. This prevents a resumed session from replaying old system
instructions or an old tool list.

## RPC sequence

1. Spawn Pi, read stdout as JSONL, and keep stderr in the job log (never parsed as protocol).
2. `set_auto_retry { "enabled": false }` — no automatic retry (FR-017).
3. `get_state` — assert the expected model, thinking level, session ID, and that `isStreaming` is
   false. A mismatch fails with `environment`.
4. `prompt { "message": <prompt envelope> }` — subscribe to events before sending.
5. Consume events until `agent_settled` or the deadline. `agent_end` is not sufficient; retries,
   compaction, or queued work may follow.
6. If an `auto_retry_*` or retry-scheduled event appears, abort and fail with `unexpected-retry`.
7. `get_last_assistant_text` — capture the final text for the output parser.
8. `get_session_stats` — record token/cost figures in the run log for operators; not required by the
   spec and never used to gate a run.
9. Close stdin for orderly shutdown. If the process does not exit within 10 seconds, terminate the
   process group.
10. On deadline, send `abort` and wait briefly for `agent_settled`; if it does not settle, terminate
    the process group and fail with `timeout`.

## Event handling

| Event | Handling |
|-------|----------|
| `message_update` | Optional progress forwarding; never posted to the issue |
| `tool_execution_*` | Logged with arguments redacted; not posted |
| `agent_end` | Not terminal; keep consuming |
| `agent_settled` | The run is idle; proceed to output parsing |
| `auto_retry_scheduled`, `auto_retry_attempt_start` | Abort, fail `unexpected-retry` |
| `summarization_retry_scheduled` | Treat as a retry; abort, fail `unexpected-retry` |
| `compaction_*` | Logged; compaction itself is allowed |
| `extension_ui_request` | Not expected (no extensions); respond with cancel if one arrives |

## Deadline and cancellation

- `agentDeadlineMinutes` from config (default 45) starts when the prompt is sent.
- The job timeout is 60 minutes, leaving time to commit, push, open the PR, and comment.
- On cancellation, the orchestrator still attempts to:
  1. capture the last assistant text,
  2. save the session cache,
  3. mark the run `failed` with `timeout`,
  4. post the failure comment,
  5. leave any commits already created on the branch.
- It never merges or force-pushes during cleanup.

## Egress policy

`.github/scripts/agent-egress.sh` implements FR-026:

- Creates the `agent-egress` user (UID 1500) if absent.
- Resolves every host in `network.allowHosts` to IPv4 addresses.
- Allows loopback, established flows, DNS to the configured nameservers, and TCP 443 to the resolved
  addresses, for that UID only.
- Installs a rate-limited `LOG` rule with the fixed prefix `agent-egress-blocked` before the final
  `DROP`, so a denied connection is visible in the kernel log.
- Drops all other IPv4 traffic from that UID and all IPv6 traffic from that UID.
- Fails closed if the allowlist is empty, a host cannot be resolved, or the rules cannot be applied.
- Prints the applied policy to the job log for auditability.

After Pi exits, the orchestrator reads the kernel log for the `agent-egress-blocked` prefix (via
`dmesg` or `journalctl -k` with the job's start time) and includes the count and destination hosts in
the result or failure comment. This is how SC-011's "every blocked attempt is reported" is met without
trusting the agent to report its own denied connection.

The orchestrator verifies the egress UID and runs Pi under it. The workspace and its ancestors are made
traversable for that UID; the agent user owns the workspace so it can edit files.

**Allowlist baseline**:

```text
ollama.com              # model provider
registry.npmjs.org      # package installs
```

Add a host only with a reviewed configuration change. The provider host in `models.json` must be
present in the allowlist; the config loader checks this and fails closed.

## What the agent may do

- Read, create, edit, grep, find, and list files in the workspace.
- Run shell commands in the workspace, including builds and tests.
- Install packages from the declared registries.
- Reach the model provider.

## What the agent may not do

- Receive or use a GitHub token, a Git credential, or a push-capable SSH key.
- Push, merge, approve, close, label, or comment through GitHub.
- Reach an undeclared host.
- Escape the workspace through a secret or a world-readable path; the runner's secret files are not
  mounted into the workspace and the agent UID cannot read the runner's home.
