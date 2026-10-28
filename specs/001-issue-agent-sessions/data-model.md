# Data Model: Issue-Driven Agent Sessions

**Feature**: `001-issue-agent-sessions` | **Date**: 2026-10-28

The implementation has no database. Everything below is either derived from GitHub at run time or
persisted in the repository: the issue thread state marker, result comments, the feature branch, and
the pull request. The TypeScript types are the source of truth for parsing and validation.

## Entity overview

```text
IssueWorkRequest 1 ─── * Trigger
        │ 1
        │
        └─── 1 AgentSession ─── * Run
                    │ 1
                    ├─── 0..1 FeatureBranch ─── 0..1 PullRequest
                    ├─── 1 StateRecord (bot comment, updated in place)
                    └─── * ResultComment (append-only)
```

## IssueWorkRequest

The task as expressed by the issue. It is inbound content, not instruction.

| Field | Type | Rules |
|-------|------|-------|
| `issueNumber` | integer | > 0, immutable for the session |
| `repository` | `{ owner: string; name: string }` | from the workflow event |
| `title` | string | 1..1024 characters; may be non-English |
| `body` | string | 0..65536 characters; may be non-English |
| `author` | string | GitHub login of the issue author |
| `labels` | string[] | current labels at trigger time |
| `state` | `"open" \| "closed"` | current issue state |
| `versionHash` | string | SHA-256 of title, body, and the last edited timestamp; changes when the request changes |
| `comments` | Comment[] | bounded, oldest-first, with truncation recorded |

**Validation**: the request version is computed at every run. If it differs from the version stored in
the state marker, the run is a resume against a changed request and the prompt says so; the agent
must not silently continue against outdated instructions (FR-018).

## Trigger

The explicit signal that starts or resumes work.

| Field | Type | Rules |
|-------|------|-------|
| `kind` | `"label" \| "resume-command"` | no other kinds start work |
| `actor` | string | GitHub login |
| `permission` | `"admin" \| "maintain" \| "write"` | effective repository permission at trigger time |
| `at` | ISO-8601 string | event timestamp |
| `commentId` | integer \| null | set for `resume-command` |
| `commandText` | string \| null | text after the resume command; may be empty |
| `labelName` | string \| null | set for `label` |

**Rules**:

- A `label` trigger must carry the configured trigger label.
- A `resume-command` trigger must have the configured command as the first line, with a word
  boundary after it; the remainder of the comment is the follow-up instruction.
- Comments authored by bots, and comments on pull requests, are never triggers.
- A trigger by an actor without effective write access is ignored with an English explanation and
  does not change the session state.

## AgentSession

One ongoing conversation bound to one issue.

| Field | Type | Rules |
|-------|------|-------|
| `id` | string | `issue-<issueNumber>`; stable for the issue |
| `piSessionId` | string | `issue-<issueNumber>-<fingerprint8>`; may change when configuration changes |
| `fingerprint` | string | SHA-256 prefix over instructions, config, model, tools, and Pi version |
| `issueNumber` | integer | exactly one issue |
| `slug` | string | `^[a-z0-9]+(?:-[a-z0-9]+)*$`, 1..50 characters; fixed on first run |
| `branchName` | string | `feature/<issueNumber>-<slug>` |
| `state` | SessionState | see transition table |
| `requestVersion` | string | version hash of the issue request the last run acted on |
| `baseSha` | string \| null | commit the branch was based on at first write |
| `headSha` | string \| null | last pushed commit |
| `pullRequestNumber` | integer \| null | open or last known PR |
| `createdAt` | ISO-8601 string | first accepted trigger |
| `updatedAt` | ISO-8601 string | last state change |
| `lastTrigger` | Trigger | most recent accepted trigger |
| `runs` | RunSummary[] | bounded history, newest last |
| `lastFailure` | `{ reason: string; nextAction: string } \| null` | set only in `failed` |

**Uniqueness**: `id` is derived from the issue number, so two issues can never share a session and one
issue can never have two sessions. Concurrency is enforced before the session is mutated.

## SessionState

```text
accepted ──► working ──► finished
                │  ├───► waiting ──► working (explicit resume)
                │  ├───► failed  ──► working (explicit resume)
                │  └───► stopped ──► working (issue reopened + explicit resume)
                └──────► stopped (issue closed)
```

| State | Meaning | Allowed next states |
|-------|---------|---------------------|
| `accepted` | Trigger passed the permission gate; work has not started | `working`, `stopped`, `failed` |
| `working` | A run is active | `waiting`, `finished`, `failed`, `stopped` |
| `waiting` | The agent needs an answer from a human | `working`, `stopped` |
| `finished` | The run produced a result and no further action is pending | `working` after reopen + resume |
| `failed` | The run ended without completing | `working` after explicit resume |
| `stopped` | The issue was closed or the change was rejected | `working` after reopen + resume |

**Rules**:

- `accepted` and `working` are active states; no run may start in an active state.
- A terminal state is recorded before the job ends; a session never stays `working` after its job.
- A merge moves the session to `finished`; a close without merge moves it to `stopped`.
- An issue close moves any non-terminal state to `stopped`, preserving the last run information.

## Run

One attempt to fulfil or continue the request.

| Field | Type | Rules |
|-------|------|-------|
| `id` | string | GitHub Actions run ID plus attempt |
| `trigger` | Trigger | the trigger that started this run |
| `startedAt` | ISO-8601 string | after the state marker is read |
| `endedAt` | ISO-8601 string \| null | set on every terminal path |
| `outcome` | `"finished" \| "waiting" \| "failed" \| "stopped"` \| null | null while active |
| `piSessionId` | string | Pi session used for this run |
| `commitShas` | string[] | commits created by this run |
| `changedPaths` | string[] | files changed by the commits, for the summary |
| `verification` | string[] | checks the agent reports as run |
| `failureReason` | string \| null | machine-readable reason code |
| `nextAction` | string \| null | plain-language next step |

**Invariant**: a run never starts a second run for the same issue while `state ∈ {accepted, working}`.

## FeatureBranch

| Field | Type | Rules |
|-------|------|-------|
| `name` | string | `feature/<issueNumber>-<slug>` |
| `baseSha` | string | default-branch commit at branch creation |
| `headSha` | string \| null | last commit pushed by the orchestrator |
| `createdByRun` | string | run ID |
| `lastMergedDefaultSha` | string \| null | default-branch commit last merged into the branch |

**Rules**:

- Never the default branch.
- Never force-pushed, rebased, reset, or deleted by the orchestrator.
- On resume, merge `origin/<default>` into the branch; if the merge conflicts, the conflicted paths
  are handed to the agent and reported.
- If the branch is missing on resume (for example after a merged PR deleted it), recreate it from the
  current default and record that recovery in the thread.
- A branch exists for every run that ends `finished` or `waiting`. If the run produced no file changes,
  the branch carries one empty commit recording the outcome. A `failed` or `stopped` run has a branch
  only when it produced file changes to preserve as a work-in-progress commit.

## PullRequest

| Field | Type | Rules |
|-------|------|-------|
| `number` | integer | > 0 |
| `state` | `"open" \| "closed"` | observed from GitHub |
| `merged` | boolean | true only after a human merge |
| `mergedBy` | string \| null | GitHub login |
| `mergedAt` | ISO-8601 string \| null | merge timestamp |
| `headBranch` | string | must equal the session's branch |
| `baseBranch` | string | repository default branch |
| `createdByRun` | string | run that opened the PR |

**Rules**:

- At most one open PR per session branch; find before create.
- The orchestrator never merges, approves, or dismisses a review.
- The PR body links the issue and never contains a non-English quotation of the issue unless it is
  explicitly marked as a quotation; the default is an English summary only.

## AgentOutput

The structured result the agent must emit at the end of a run.

| Field | Type | Rules |
|-------|------|-------|
| `summary` | English string | 1..4000 characters; what changed and why |
| `verification` | English string[] | checks run; may be empty with an explanation |
| `openQuestions` | English string[] | unanswered questions; empty when none |
| `couldNotComplete` | English string[] | parts not done; empty when none |
| `prTitle` | English string | 1..120 characters |
| `prBody` | English string | 1..8000 characters; must not claim a merge |
| `state` | `"finished" \| "waiting"` | `waiting` requires at least one open question |

**Validation**: the orchestrator extracts the last fenced ```json block from the final assistant
message. A missing or invalid block fails the run with `agent-output`. The orchestrator redacts every
field before rendering and truncates it to the limits above. A `couldNotComplete` entry prevents the
session from being reported as fully finished; the resulting state is `waiting` or `failed` depending
on whether a human answer can unblock it.

## StateRecord

The machine-readable part of the single bot-owned state comment.

| Field | Type | Rules |
|-------|------|-------|
| `schema` | integer | exactly `1` for this version |
| `session` | AgentSession | fields above |
| `lastRun` | RunSummary \| null | most recent run |
| `sessionCommentId` | integer | the comment that owns this record |
| `updatedByRun` | string | run ID of the last writer |

**Serialization**: one line of JSON inside an HTML comment so the marker cannot render as content:

```text
<!-- agent-session-state {"schema":1,...} -->
```

**Recovery**: if the marker is absent or malformed, the orchestrator rebuilds the session from the
issue, any result comments, and the existing branch, then writes a new marker and states in the
thread that it recovered state. If the branch name cannot be derived or conflicts with the issue, the
run fails with `state-recovery` rather than guessing.

## ResultComment

An append-only English summary of one run.

| Field | Type | Rules |
|-------|------|-------|
| `runId` | string | GitHub Actions run ID |
| `marker` | string | hidden `<!-- agent-run:<runId> -->` for idempotency |
| `state` | SessionState | state after the run |
| `summary` | string | rendered from `AgentOutput.summary` |
| `branchLink` | string \| null | link to the branch |
| `prLink` | string \| null | link to the PR |
| `verification` | string[] | rendered list |
| `openQuestions` | string[] | rendered list |
| `couldNotComplete` | string[] | rendered list |
| `nextAction` | string | English next step for a human |

## SessionDigest

The fallback context when the Pi session cache is missing.

| Field | Type | Rules |
|-------|------|-------|
| `issue` | IssueWorkRequest | current version |
| `recentComments` | Comment[] | bounded; includes human follow-ups and prior agent results |
| `priorResults` | ResultComment[] | summaries only, not raw transcripts |
| `branchDiffStat` | string | `git diff --stat` against the default branch |
| `unresolvedConflicts` | string[] | paths with conflict markers after the default merge |
| `sessionState` | SessionState | from the state marker |

**Purpose**: gives a fresh Pi conversation enough context to continue without repeating finished
steps. It is always built; the cache is an optimization, not a requirement.

## Configuration entity

See [contracts/config.md](./contracts/config.md) for the full schema. At the data-model level, the
configuration contributes the trigger label, resume command, model, tool allowlist, egress allowlist,
instruction path, and deadlines; its hash is part of the session fingerprint.

## Validation and invariants

1. `issueNumber` and `slug` uniquely determine `branchName`; a branch that exists under a different
   slug is never reused for the same issue.
2. `state` transitions must follow the table; an invalid transition fails the run before any GitHub
   write.
3. A trigger must resolve to exactly one issue and one session.
4. The request version is recomputed on every run; a changed request is reported, not silently ignored.
5. Every terminal path writes `endedAt`, `outcome`, `state`, and an English result or failure comment.
6. No GitHub write happens before the permission gate and the state transition succeed.
7. No commit is created when there are no file changes, except the single empty outcome commit required
   for a `finished` or `waiting` session's branch.
8. A branch exists for every completed (`finished` or `waiting`) session, so the session-to-branch
   mapping is never ambiguous.
9. No merge, force-push, branch deletion, or direct default-branch commit is performed by the
   orchestrator.
