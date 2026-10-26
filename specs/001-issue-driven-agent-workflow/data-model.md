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
| `kind` | `change` \| `answer` | Derived from the agent's own classification, reported in the ack | Must be stated in the thread; drives whether a proposal is expected |

### 2. Trigger

The signal that work should happen.

| Field | Type | Source | Validation |
|-------|------|--------|------------|
| `origin` | `new-issue` \| `label` \| `retry-command` | Event that started the job | Must be one of the three; every run records it (SC-015) |
| `actor` | login | Comment author or label actor | Must hold write access at trigger time (FR-024) |
| `at` | timestamp | Event payload | Required |
| `commandId` | identifier | Comment id for command triggers | Required for command origins; used for idempotency |

### 3. Run

One attempt to fulfil a request.

| Field | Type | Source | Validation |
|-------|------|--------|------------|
| `runId` | identifier | Workflow run id + attempt | Unique per job |
| `issueNumber` | integer | — | Exactly one active run per issue (FR-013) |
| `state` | enum | Label | One of the states in the state machine below (FR-010) |
| `startedAt` / `endedAt` | timestamps | Orchestrator | `endedAt` required before a terminal state is declared (FR-011) |
| `instructionsVersion` | commit SHA + hash of `.agent/instructions.md` | Workspace | Recorded so behaviour is reproducible (FR-014, SC-005) |
| `piVersion`, `modelId` | strings | Config | Pinned; recorded per run (D12) |
| `consumption` | `{costUsd, tokens, toolCalls, turns}` | `get_session_stats` at each turn | Monotonic within a session; cumulative across resumed runs (D6) |
| `continuesRunId` | identifier, optional | Config/cache | Set when started by a retry or continue command (FR-032) |
| `outcome` | `finished` \| `failed` \| `halted` \| `rejected` | Final transition | Terminal states only (FR-011) |
| `failureReason` | enum + text | Orchestrator | Distinguishes requester-actionable from environmental (FR-012) |

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
| `state` | enum | Label + comment | Must match the label at all times (invariant I1) |
| `at` | timestamp | Comment | Required |
| `requestVersion` | identifier | — | Restated when the request changed under the run (FR-023) |
| `marker` | string | Comment body | Stable HTML-comment marker identifying the orchestrator's status comment, enabling edit-in-place instead of comment spam |

### 6. Proposed Change

A reviewable proposal.

| Field | Type | Source | Validation |
|-------|------|--------|------------|
| `branch` | `agent/<issue>-<slug>` | Git | Must not exist; never the default branch |
| `prNumber` | integer | Pull request | Created by the orchestrator only (FR-007) |
| `changedPaths` | list | Diff | Non-empty; redaction applied to content before commit (D10) |
| `approvalState` | `unreviewed` \| `approved` \| `rejected` | Reviews + `/agent approve`/`reject` | Never set by the agent (FR-008) |
| `decidedBy`, `decidedAt` | login, timestamp | Comment on the issue and review on the PR | Recorded in the thread (FR-009) |

### 7. Decision

| Field | Type | Source | Validation |
|-------|------|--------|------------|
| `kind` | `halt` \| `retry` \| `continue` \| `approve` \| `reject` | Command word | Must be a known word; unknown words produce a help reply, never a run |
| `actor` | login | Comment author | Write access re-checked at decision time (FR-025) |
| `reason` | text, optional | Command arguments | Captured verbatim (sanitised) for audit |
| `at` | timestamp | Comment | Required |
| `effectiveAtBoundary` | integer, optional | Orchestrator | Present when applied at a boundary rather than immediately |

### 8. Standing Instruction

Repository-stored behaviour configuration.

| Field | Type | Source | Validation |
|-------|------|--------|------------|
| `instructionsPath` | path | `.agent/instructions.md` | Must exist on the checked-out trusted ref (FR-014) |
| `configPath` | path | `.agent/config.yml` | Schema-validated; invalid config fails the run before any model call |
| `version` | commit SHA + content hash | Git | Applied to new runs only (FR-014) |
| `limits` | `{maxCostUsd, warnAtRatio, continueIncrementUsd, maxTurns, maxWallClockMinutes}` | Config | All positive; warn ratio in (0, 1) |
| `promptTemplates` | list of paths | Config | Each path must exist on the trusted ref, be a `.md` file under the repository, and be loaded explicitly with `--prompt-template`. Empty list is valid: the agent then has no slash commands at all (research D13) |

### 9. Audit Entry

Not a separate store. It is the ordered join of Status Updates, Decisions, and the proposal links for
one issue — which is why the record can be reconstructed from the repository alone (FR-016). The
reconstruction procedure is specified in `contracts/thread-messages.md` so a third party can follow
it without knowing this document.

## State machine

```text
                 (label added by permitted person)
   [no agent state] ─────────────────────────────► queued
                                                    │  job starts, ack posted
                                                    ▼
                                                  working ──────────────► waiting
                                                    │                      │  (needs a human
                                                    │                      │   decision: continue,
                                                    │                      │   ambiguity, limit)
                                                    │                      ▼
                                     (halt command) │                    working
                                                    ▼
                                                  halted ──── (retry/continue) ──► working
                                                    │
     (proposal produced, awaiting human) ───────────┴─────────► waiting
                                                    │
          (run ended successfully) ─────────────────┴─────────► finished
                                                    │
          (run failed, reason posted) ──────────────┴─────────► failed  ── (retry) ──► working
```

| Label | Meaning | Terminal |
|-------|---------|----------|
| `agent:queued` | Trigger accepted, job not yet started | no |
| `agent:working` | A run is active | no |
| `agent:waiting` | A human decision is required (limit, ambiguity, review) | no |
| `agent:halted` | Stopped by command or global halt; feedback posted | no |
| `agent:finished` | Run ended, result posted | yes |
| `agent:failed` | Run ended with a failure reason | yes |
| `agent:rejected` | Proposal rejected by a human; no automatic retry | yes |

Only one `agent:*` state label may be present at any time. The start label `agent:run` is separate
from the state labels: it is the *request* to work, not a state.

## Validation rules (requirement → rule)

| Rule | Requirement | Enforcement point |
|------|-------------|-------------------|
| V1 | FR-024, FR-025 | Permission check at trigger and again at every decision; failure posts an explanation and changes nothing |
| V2 | FR-013 | Concurrency group per issue plus an "active run" check against the state label before starting |
| V3 | FR-011, FR-010 | Final state is written in the same step that posts the terminal comment; a watchdog marks a run failed if the job dies leaving `agent:working` |
| V4 | FR-017 | Budget checked per boundary; hard stop posts the consumed amount and requires `continue` |
| V5 | FR-016, FR-030 | Every message the orchestrator posts carries the run id, so the thread is self-describing |
| V6 | FR-019, constitution I | All orchestrator-owned strings come from English templates in `messages.js`; agent output is redacted, not translated |
| V7 | FR-029, FR-030 | Tool allowlist excludes any forge or git mutation tool; ignored directives are reported by the orchestrator when the agent signals one, and by the standing instruction otherwise |
| V8 | FR-023 | Request version (body hash) compared at run start and at each boundary; a change triggers stop-and-restate |
