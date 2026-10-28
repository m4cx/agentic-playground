# Contract: Session State

**Feature**: `001-issue-agent-sessions` | **Version**: 1

The issue thread is the authoritative record. This contract defines the one state comment per issue,
the hidden marker inside it, the state machine, and the recovery rules.

## The state comment

There is exactly one state comment per issue, authored by the workflow token. It is updated in place
with `PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}`.

Visible part (rendered from the marker, English):

```markdown
### Agent session

| | |
|---|---|
| **State** | working |
| **Session** | issue-42 |
| **Branch** | `feature/42-fix-login-timeout` |
| **Pull request** | #57 |
| **Last run** | 2026-10-28 14:12 UTC |
| **Request version** | `sha256:8f3c…` |

The agent is working on this issue. The latest result is posted as a separate comment.
```

Machine-readable part (one line, inside an HTML comment):

```text
<!-- agent-session-state {"schema":1,"session":{"id":"issue-42","piSessionId":"issue-42-a1b2c3d4","fingerprint":"a1b2c3d4","issueNumber":42,"slug":"fix-login-timeout","branchName":"feature/42-fix-login-timeout","state":"working","requestVersion":"sha256:8f3c…","baseSha":"…","headSha":null,"pullRequestNumber":57,"createdAt":"2026-10-28T13:50:00Z","updatedAt":"2026-10-28T14:12:00Z","lastTrigger":{"kind":"label","actor":"maintainer","permission":"write","at":"2026-10-28T13:50:00Z","commentId":null,"commandText":null,"labelName":"agent:run"},"runs":[],"lastFailure":null},"lastRun":null,"sessionCommentId":123456789,"updatedByRun":"1234567890"} -->
```

**Rules**:

- `schema` is exactly `1`; an unknown schema is a `state-recovery` failure, not a silent upgrade.
- JSON is one line; no newline inside the comment.
- The marker contains no secrets and no raw issue text.
- The comment body is regenerated from the marker on every write, so the visible table cannot drift
  from the machine-readable state.
- `sessionCommentId` is written after the first successful comment creation; it is absent in the
  in-memory record before that point.

## State machine

```text
                 label / resume
(none) ─────────────────────────► accepted
                                      │
                                      ▼
                                   working
                                   │  │  │
                    ┌──────────────┘  │  └──────────────┐
                    ▼                 ▼                 ▼
                 waiting           finished           failed
                    │                 │                 │
                    │ resume          │ reopen+resume   │ resume
                    └────────► working ◄─────────────────┘

working ──► stopped   (issue closed)
working ──► stopped   (PR closed without merge)
working ──► finished  (PR merged)
```

| From | Event | To | Side effects |
|------|-------|----|--------------|
| none | accepted trigger | `accepted` | create marker, acknowledge, remove label |
| `accepted` | agent process starts | `working` | record run start |
| `working` | agent returns `finished` | `finished` | commit/push/PR, result comment |
| `working` | agent returns `waiting` | `waiting` | result comment with open questions |
| `working` | agent fails or deadline | `failed` | failure comment, no retry |
| `working` | issue closed | `stopped` | failure/stop comment, leave commits on branch |
| `working` | PR merged | `finished` | outcome comment with merger and timestamp |
| `working` | PR closed unmerged | `stopped` | outcome comment with closer and timestamp |
| `waiting` | resume signal | `working` | same branch, same session |
| `failed` | resume signal | `working` | same branch, same session |
| `stopped` | reopen + resume signal | `working` | same branch, same session |
| `finished` | reopen + resume signal | `working` | same branch, same session |

An invalid transition is a `state-transition` failure: the run stops before any GitHub write, posts a
failure comment only if the marker is valid, and leaves the stored state untouched.

## Result comment

Each run that reaches a terminal or waiting state posts one append-only comment:

```markdown
<!-- agent-run:1234567890 -->
### Agent result

**State:** finished
**Branch:** `feature/42-fix-login-timeout`
**Pull request:** #57

**Summary**
The login timeout now uses the configured value instead of a hard-coded 30 seconds.

**Verification**
- `npm test` — 42 passed
- `npm run build` — passed

**Open questions**
- None.

**Not completed**
- None.

**Next action**
Review pull request #57 and merge it when satisfied.
```

The comment is rendered from the validated `AgentOutput` and fixed English templates. Raw model prose
is never posted as the durable summary.

## Concurrency and idempotency

1. The workflow concurrency group serializes runs for the same issue with
   `cancel-in-progress: false`.
2. The orchestrator re-reads the issue thread at the start of the run and refuses to continue if the
   state is `accepted` or `working` (another run is active).
3. The comment ID of a resume trigger is stored in `session.lastTrigger.commentId`; a duplicate delivery
   is a no-op.
4. Result comments are deduplicated by the `agent-run:<runId>` marker. The state comment is updated,
   not appended.
5. A workflow re-run has a new run ID and is treated as a new attempt; this is visible in the thread.

## Recovery

If the state comment is missing or its marker cannot be parsed:

1. Read the issue, its comments, and the branch list.
2. Derive the issue number from the event and look for a branch matching
   `feature/<issueNumber>-*`.
3. If exactly one branch matches, recover `slug`, `branchName`, `baseSha`, and `headSha` from Git.
4. Rebuild the marker with state `stopped` if the issue is closed, otherwise `waiting`, and record the
   recovery reason in the visible comment.
5. If no branch exists, create a session in `accepted` state with a new slug.
6. If two or more branches match, fail with `state-recovery` and list the candidate branches; do not
   choose silently.

The recovery never invents a prior run history. `runs` starts empty and the thread explains that the
history before recovery is only available from the issue comments.

## Marker validation

| Check | Failure |
|-------|---------|
| Marker occurs at most once | `state-recovery` |
| JSON parses and `schema == 1` | `state-recovery` |
| `session.issueNumber` matches the event issue | `state-recovery` |
| `slug` matches `^[a-z0-9]+(?:-[a-z0-9]+)*$` and is ≤ 50 characters | `state-recovery` |
| `branchName == feature/<issueNumber>-<slug>` | `state-recovery` |
| `state` is a known value | `state-recovery` |
| `runs` is an array and bounded | drop the oldest entries with a warning |
| No secret-like value in the marker | redact, then fail `redaction` |

## Secret handling

The marker and every comment pass through `src/agent/redact.ts` before posting. It removes the job
token, the provider key, and common credential patterns (`ghs_`, `github_pat_`, `sk-`, bearer tokens).
If redaction changes a value that the orchestrator needs to keep (for example a commit SHA is
mistakenly matched), the run fails with `redaction` rather than posting a corrupted record.
