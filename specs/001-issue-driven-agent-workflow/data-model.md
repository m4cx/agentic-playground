# Data Model: Issue-Driven Agentic Workflow

**Feature**: `001-issue-driven-agent-workflow` | **Date**: 2026-10-26

There is no database. Every entity below is a projection over three durable stores the repository
already has — labels, comments, and pull requests — plus one non-authoritative cache (the Pi session
file). The model therefore records, for each entity, *where each field physically lives*.

## Storage legend

| Store | Authority | Notes |
|-------|-----------|-------|
| Labels | State only | Fast, visible, mutable by permitted people; never used to store history |
| Comments | Record + history | Append-only in practice; never edited to change meaning |
| Pull request | Proposal | Diff, review state, merge state |
| Cache (Pi session file) | None | Continuity aid; loss must degrade, never corrupt |
| Workflow job log | Diagnostics | For operators, not part of the record a third party reads |

## Entities

### 1. Work Request

The task a person expressed in the issue.

| Field | Type | Source | Validation |
|-------|------|--------|------------|
| `issueNumber` | integer | Issue | Required, positive |
| `repository` | `owner/name` | Event payload | Must equal the configured repository |
| `requestText` | text | Issue title + body | Non-empty; else the run fails with an actionable reason (FR-012) |
| `requestVersion` | identifier of the last edit | Issue `updated_at` + body hash | Captured at run start and restated in feedback (FR-023) |
| `requestedBy` | login | Issue author | Informational |
| `kind` | `change` \| `answer` | The agent's own classification, produced at the first action boundary | Must be stated in the thread (status comment, not the acknowledgement, which precedes any model call); drives whether a proposal is expected |

### 2. Trigger

The signal that work should happen.

| Field | Type | Source | Validation |
|-------|------|--------|------------|
| `origin` | `label` \| `retry-command` \| `continue-command` | Event that started the job | Closed set. `label` is the only origin that starts *new* work; the other two continue an existing recorded request (FR-026) |
| `event` | `issues.opened` \| `issues.labeled` \| `issue_comment` | Event payload | Recorded for diagnostics. `issues.opened` is only a pre-check: it starts nothing unless the request label is already present |
| `actor` | login | Comment author or label actor | Must hold write access at trigger time (FR-024) |
| `at` | timestamp | Event payload | Required |
| `commandId` | identifier | Comment id for command triggers | Required for command origins; used for idempotency |

### 3. Run

One attempt to fulfil a request.

| Field | Type | Source | Durable artifact (FR-016) | Validation |
|-------|------|--------|---------------------------|------------|
| `runId` | identifier | Workflow run id + attempt | `agent:status` marker and every appended row | Unique per job |
| `issueNumber` | integer | Event payload | Issue itself | Exactly one active run per issue (FR-013) |
| `state` | enum | Label + status log | Append-only state log in the status comment; label mirrors it | One of the states in the state machine below (FR-010) |
| `startedAt` / `endedAt` | timestamps | Orchestrator | `agent:ack`; state-log row | `endedAt` required before a terminal state is declared (FR-011); `startedAt` minus the trigger time is the queue delay reported in the acknowledgement (SC-016) |
| `instructionsVersion` | commit SHA + hash of `.agent/instructions.md` | Workspace | `agent:ack` | Recorded so behaviour is reproducible (FR-014, SC-005) |
| `piVersion`, `modelId`, `thinking` | strings | Resolved Pi package (installed + `package-lock.json`) for `piVersion`; `.agent/config.yml` for `modelId`/`thinking` | `agent:ack` | `piVersion` must equal the exact dependency pin and is never hardcoded; `modelId`/`thinking` come from configuration (D12, research D16) |
| `fingerprint` | hash of instructions content + `model` + `thinking` + `tools` + `promptTemplates` + pinned Pi version | `.agent/config.yml`, `package-lock.json`, workspace | `agent:ack` (short form) | Determines whether a stored session may be resumed; a Pi upgrade changes it (research D5, D16, `contracts/config.md`) |
| `consumption` | `{costUsd, tokens, toolCalls, turns}` | `get_session_stats` at each boundary | Status-log rows, `agent:session`, `agent:result` | Monotonic within a session; the per-issue total is the sum of the documented sessions (§8), so a lost cache cannot reset it |
| `continuesRunId` | identifier, optional | Thread record | `agent:ack`, status-log row | Set when started by a retry or continue command (FR-032) |
| `outcome` | `finished` \| `failed` \| `halted` \| `rejected` | Final transition | `agent:result` / `agent:error` | `rejected` is issue-level, not run-level; `halted` ends the run but leaves the issue resumable (see the label table) |
| `failureReason` | enum + text | Orchestrator | `agent:error` | Distinguishes requester-actionable from environmental (FR-012) |

### 4. Action Boundary

The unit at which a pending command takes effect. Not stored; it is an interpretation rule over the
Pi event stream: a boundary is a completed `turn_end` (assistant response plus its tool calls and
results). Commands arriving during a turn are queued and applied at the next boundary (FR-027).

| Field | Type | Notes |
|-------|------|-------|
| `boundaryIndex` | integer | Count of `turn_end` events observed in this run |
| `pendingCommands` | ordered list | Drained at each boundary, in arrival order |

### 5. Status Update

The visible state record in the thread.

| Field | Type | Source | Validation |
|-------|------|--------|------------|
| `state` | enum | Label + status log | The label must match the newest row of the state log (invariant I2) |
| `at` | timestamp | Comment | Required |
| `requestVersion` | identifier | — | Restated when the request changed under the run (FR-023) |
| `marker` | string | Comment body | Stable HTML-comment marker identifying the status comment (`agent:status`), so there is exactly one per issue |
| `rows` | ordered list | Comment body, append-only | One row per transition (`at`, `state`, `runId`, `consumption`, `next act`). Earlier rows are never rewritten, so the body itself is the state timeline (FR-016, SC-005) and no comment edit history is required |

### 6. Proposed Change

A reviewable proposal.

| Field | Type | Source | Validation |
|-------|------|--------|------------|
| `branch` | `agent/<issue>-<slug>` | Git | Must not exist; never the default branch |
| `prNumber` | integer | Pull request | Created by the orchestrator only (FR-007) |
| `changedPaths` | list | Diff | Non-empty; redaction applied to content before commit (D10) |
| `approvalState` | `unreviewed` \| `approved` \| `rejected` | Reviews, `/agent approve`/`reject` | Never set by the agent (FR-008) |
| `outcome` | `open` \| `merged` \| `closed-unmerged` | `pull_request.closed` | Observed by the orchestrator; resolves the issue (FR-033) |
| `decidedBy`, `decidedAt` | login, timestamp | Comment on the issue, review on the PR, or the merge event | Recorded in the thread (FR-009) |

### 7. Decision

| Field | Type | Source | Validation |
|-------|------|--------|------------|
| `kind` | `halt` \| `retry` \| `continue` \| `approve` \| `reject` \| `merge` \| `close` | Command word, review, or pull-request close | Must be a known kind; unknown words produce a help reply, never a run |
| `source` | `command` \| `review` \| `close` | Where the decision came from | `merge` and `close` only ever come from `close`; the agent process is never a source |
| `actor` | login | Comment author | Write access re-checked at decision time (FR-025) |
| `reason` | text, optional | Command arguments | Captured verbatim after redaction, for audit |
| `at` | timestamp | Comment | Required |
| `effectiveAtBoundary` | integer, optional | Orchestrator | Present when applied at a boundary rather than immediately |

### 8. Continuity Session

One Pi conversation. A new session starts whenever the configuration fingerprint changes or the cache is
lost, so an issue can have several sessions over its life.

| Field | Type | Source | Durable artifact (FR-016) | Validation |
|-------|------|--------|---------------------------|------------|
| `sessionId` | `agent-issue-<n>-<fingerprint-short>` | Launch arguments | `agent:session` message | Unique per issue and fingerprint |
| `fingerprint` | hash | `.agent/config.yml` + instructions + pinned Pi version | `agent:ack`, `agent:session` | Equal on both sides of a resume; includes `piVersion` so an upgrade starts a fresh session (FR-014, research D5/D16) |
| `runs` | list of run ids | Orchestrator | `agent:session` | Every run of this session is listed |
| `consumed` | `{costUsd, tokens, turns, toolCalls}` | `get_session_stats` at session end | `agent:session` | Recorded per session, never folded into a single number |
| `endedBecause` | `finished` \| `halted` \| `failed` \| `lost` | Orchestrator | `agent:session` | `lost` when the cache disappeared without a recorded end |

**Accounting rule**: the per-issue consumption — the number the limit applies to — is the sum of the
`consumed` values of all documented sessions of that issue. A new session adds its own value; it never
overwrites an earlier one. This is why a lost cache cannot reset the limit, and why a reader can see which
session spent what (decision recorded in `spec.md` §Clarifications; `contracts/thread-messages.md` §8).

### 9. Standing Instruction

Repository-stored behaviour configuration.

| Field | Type | Source | Validation |
|-------|------|--------|------------|
| `instructionsPath` | path | `.agent/instructions.md` | Must exist on the checked-out trusted ref (FR-014) |
| `configPath` | path | `.agent/config.yml` | Schema-validated; invalid config fails the run before any model call |
| `version` | commit SHA + content hash | Git | Applied to new runs only (FR-014) |
| `limits` | see `contracts/config.md` | Config | Schema-validated; an invalid value fails the run before any model call |
| `promptTemplates` | list of paths | Config | Each path must exist on the trusted ref, be a `.md` file under the repository, and be loaded explicitly with `--prompt-template`. Empty list is valid: the agent then has no slash commands at all (research D13) |
| `fingerprint` | hash | Derived from instructions content, `model`, `thinking`, `tools`, `promptTemplates`, and the pinned Pi version | Must be equal on both sides of a session resume; a mismatch forces a fresh session (FR-014, research D5/D16) |

### 10. Pi Runtime

Not a durable record. It describes the process the orchestrator is allowed to start, and every field is
checked before the acknowledgement and before the first model call. Only `version` reaches the repository
(in `agent:ack`); the paths stay in the job log so the record is not tied to one runner image.

| Field | Type | Source | Validation |
|-------|------|--------|------------|
| `nodePath` | absolute path | `process.execPath` | The interpreter that also runs the orchestrator, executable by the egress uid; not from `PATH` |
| `entry` | absolute path | `<repoRoot>/node_modules/@earendil-works/pi-coding-agent/<package.json#bin.pi>` | Must exist, be a file, and be readable by the egress uid; must not resolve outside `<repoRoot>/node_modules` |
| `version` | semver string | Installed package `package.json` | Must equal the exact dependency pin in the root `package.json` and the `package-lock.json` version; recorded in `agent:ack` (research D16) |
| `egressUid` | uid, optional | `AGENT_EGRESS_UID` written by `agent-egress.sh` | When present, the orchestrator must be uid 0 and the preflight probe must show a writable work tree, an unreachable `GIT_DIR`, no `.git` in the work tree, and a read-only `node_modules/` (research D17) |
| `workTreeOwner` | uid, optional | Orchestrator before spawn | Recursively the egress uid, so the agent can edit and create files, except `node_modules/` which stays read-only |
| `gitDir` | absolute path | Orchestrator after checkout | Outside the work tree under `RUNNER_TEMP`, root-owned mode `0700`; the egress uid cannot read or write it and the work tree has no `.git` |
| `home`, `tmpDir`, `cacheDir` | absolute paths | Orchestrator | Inside the chowned session directory, so the no-home egress user can write |

### 11. Audit Entry

Not a separate store. It is the ordered join of Status Updates, Decisions, and the proposal links for
one issue — which is why the record can be reconstructed from the repository alone (FR-016). Because
the status comment is append-only inside its body, the state timeline is part of that record and does
not depend on any comment edit history. The reconstruction procedure is specified in
`contracts/thread-messages.md` so a third party can follow it without knowing this document.

## State machine

The transition table below is authoritative; every arrow into `working` from a terminal or resting
state requires an explicit command from a permitted person, and nothing re-enters automatically.

`waiting` is a resting state, not an end state: it means a named human decision is pending. It is left
only by a command, by a review, or by the pull request being closed, and a close always resolves the
issue to `finished` (merged) or `rejected` (not merged) — so no issue can rest in `waiting` without a
proposal that is still open.

| Label | Meaning | Terminal |
|-------|---------|----------|
| `agent:queued` | Trigger accepted, job not yet started | no |
| `agent:working` | A run is active | no |
| `agent:waiting` | A human decision is required (limit, ambiguity, review) | no |
| `agent:halted` | Stopped by command or global halt; feedback posted | no |
| `agent:finished` | Run ended, result posted | yes |
| `agent:failed` | Run ended with a failure reason | yes |
| `agent:rejected` | Proposal not accepted — rejected or closed without merging; no automatic retry | yes |

Only one `agent:*` state label may be present at any time. The start label `agent:run` is separate
from the state labels: it is the *request* to work, not a state.

## Validation rules (requirement → rule)

| Rule | Requirement | Enforcement point |
|------|-------------|-------------------|
| V1 | FR-024, FR-025 | Permission check at trigger and again at every decision; failure posts an explanation and changes nothing |
| V2 | FR-013 | Concurrency group per issue plus an "active run" check against the state label before starting |
| V3 | FR-011, FR-010 | Final state is written in the same step that posts the terminal comment; the reconciler (`src/agent/reconcile.ts`, scheduled sweep) marks a run failed if the job dies leaving `agent:working` |
| V4 | FR-017 | Budget checked per boundary against the sum of documented sessions; hard stop posts the consumed amount and requires `continue` |
| V5 | FR-016, FR-030 | Every message the orchestrator posts carries the run id, so the thread is self-describing |
| V6 | FR-019, constitution I | All orchestrator-owned strings come from English templates in `messages.ts`; agent output is redacted, not translated |
| V7 | FR-006, FR-014, FR-029, FR-030 | Tool allowlist excludes any forge or git mutation tool; the agent ends its answer with the report blocks — `agent-ignored:` (mandatory), `agent-question:`, `agent-unmet:` — which the orchestrator parses and renders as `agent:notice` with its kind; a missing `agent-ignored:` block is recorded as "report missing", a missing optional block as "none" |
| V8 | FR-023 | Request version (body hash) compared at run start and at each boundary; a change triggers stop-and-restate |
| V9 | FR-031 | Any retry signal from the harness (`auto_retry_*`, `summarization_retry_*`, `compaction_*`, `willRetry`) aborts the run and fails it with `unexpected-retry` |
| V10 | FR-034 | The egress restriction is applied before Pi starts; if it cannot be applied, the run fails with `environment` and no model call happens |
| V11 | FR-033 | `pull_request.closed` is observed and written to the thread as `agent:outcome` plus a decision record; a close with an unobserved actor is recorded as `unknown` rather than guessed |
| V12 | FR-002, research D16 | Pi is resolved from the pinned package under `<repoRoot>/node_modules` and launched with `process.execPath`; `PATH`, a global install, and a range dependency all fail the run with `environment` before any model call |
| V13 | FR-034, research D17 | When egress is enforced by uid, the orchestrator is uid 0, Pi is the egress uid, the work tree is agent-writable while the git directory and `node_modules/` are outside its write reach, and the process group plus the uid-wide reap completes before diff collection |
