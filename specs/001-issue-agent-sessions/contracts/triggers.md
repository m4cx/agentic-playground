# Contract: Triggers and Permissions

**Feature**: `001-issue-agent-sessions` | **Version**: 1

This contract defines what starts agent work, what is ignored, and how the permission gate behaves.
It is implemented by `.github/workflows/agent-run.yml`, `.github/workflows/agent-resume.yml`, and
`src/agent/trigger.ts` / `src/agent/permissions.ts`.

## Workflow events

| Workflow | Event | Filter |
|----------|-------|--------|
| `agent-run.yml` | `issues` / `labeled` | `github.event.label.name == 'agent:run'` |
| `agent-resume.yml` | `issue_comment` / `created` | first line matches `^/agent continue(?:\s|$)` |
| `agent-review.yml` | `pull_request` / `closed` | none; handler decides |
| `agent-review.yml` | `issues` / `closed` | none; handler decides |
| `ci.yml` | `push`, `pull_request` | project CI only |

The literal `agent:run` and `/agent continue` in the workflow filters mirror the defaults in
`.agent/config.json`. `tests/contract/workflow-config.test.ts` reads both files and fails CI when they
diverge.

Both agent workflows use the same concurrency group and never cancel an in-flight run:

```yaml
concurrency:
  group: agent-issue-${{ github.event.issue.number }}
  cancel-in-progress: false
```

The review workflow uses `agent-review-${{ github.event.pull_request.number || github.event.issue.number }}`.
It only observes and comments; it never edits the branch.

## Start trigger (label)

A start trigger is accepted only when all of the following are true:

1. The event is `issues.labeled`.
2. The applied label equals the configured trigger label.
3. The issue is open.
4. The actor has effective repository permission `admin`, `maintain`, or `write` (checked through the
   collaborators-permission endpoint, not `author_association`).
5. No run is active for the issue. The concurrency group enforces this; the state marker is re-read
   as a second guard.
6. The issue is not already bound to a session in a state that forbids a new start. A label on an
   issue whose session is `waiting`, `failed`, `stopped`, or `finished` is a **resume**, not a new
   session.

On acceptance the orchestrator:

1. Re-reads the issue and verifies that the trigger label is still present. A label event whose label
   has already been removed by an earlier run is stale and exits without work; this prevents a queued
   duplicate label event from starting a second run.
2. Reads or creates the session marker.
3. Removes the trigger label, so the label is a one-shot trigger and can be re-applied later.
4. Posts the acknowledgement comment.
5. Sets state to `accepted`, then `working` when the agent starts.

## Resume trigger (comment)

A resume trigger is accepted only when all of the following are true:

1. The event is `issue_comment.created`.
2. The comment is on an issue, not on a pull request (`issue.pull_request` is absent).
3. The comment author is not a bot.
4. The first line of the comment matches `^/agent continue(?:\s|$)`.
5. The issue is open. A closed issue must be reopened first.
6. The author has effective write access.
7. A session marker exists for the issue.

The text after the command is the follow-up instruction. An empty remainder is allowed; the agent then
reports that it needs a concrete instruction and ends in `waiting`.

Ordinary comments — including review discussion, "thanks", and comments that mention the agent — never
start work.

## Resume trigger (re-applied label)

Re-applying the configured label to an open issue with an existing session is equivalent to the
comment resume trigger, with an empty instruction. This works because the label is removed after every
accepted start, so a new `labeled` event is produced only by a deliberate re-application.

## Ignored events

| Situation | Behavior |
|-----------|----------|
| Comment on a pull request | Ignored; the PR review flow is human-only |
| Comment by a bot (`user.type == "Bot"`) | Ignored |
| Comment not starting with the resume command | Ignored; no comment is posted |
| Trigger label on a closed issue | Ignored; the session stays stopped |
| Unauthorized actor | No work; one English comment states that write access is required, once per trigger event |
| Duplicate event for the same comment ID | Ignored; the comment ID is recorded in the session marker |

The orchestrator never replies to every ignored comment; that would turn the thread into noise and let
anyone spend the agent's comment budget.

## Permission gate

```http
GET /repos/{owner}/{repo}/collaborators/{username}/permission
Accept: application/vnd.github+json
Authorization: Bearer <GITHUB_TOKEN>
```

Accepted values: `admin`, `maintain`, `write`. Rejected values: `triage`, `read`, `none`, and any
unknown value. The check happens on every trigger, not once per session, so losing write access ends
the ability to resume.

When GitHub returns `404` for a user who is not a collaborator, the trigger is rejected. When the API
call fails for a transient reason, the run fails with `permission-check` and posts a failure comment;
it does not fall back to trusting `author_association`.

## Idempotency

- A label start records the label event's issue `updated_at` and the run ID in the marker.
- A comment resume records the comment ID. A repeated delivery of the same comment ID is a no-op.
- The acknowledgement and result comments carry hidden markers
  (`<!-- agent-ack:<runId> -->`, `<!-- agent-run:<runId> -->`); the orchestrator checks for an existing
  comment with the marker before posting.
- Re-running a failed job manually is treated as a new run with a new run ID; it is not deduplicated
  against the failed attempt. The state machine allows a resume from `failed`.

## Error behavior

| Failure | State | Thread message |
|---------|-------|----------------|
| Permission API unavailable | no change | `permission-check` failure; retry later |
| State marker unreadable and cannot be rebuilt | `failed` | `state-recovery` with the reason |
| Trigger label removal fails | run continues | warning; the next label event may be ignored as duplicate |
| Issue closed between event and run | `stopped` | no work; state recorded |
| Concurrent run already active | no change | none; the queued run starts after the active one and re-reads state |
