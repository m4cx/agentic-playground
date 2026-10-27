# Contract: Labels and State Invariants

**Feature**: `001-issue-driven-agent-workflow` | **Requirements**: FR-003, FR-010, FR-011, FR-013, FR-022

## Label inventory

| Label | Kind | Applied by | Meaning |
|-------|------|-----------|---------|
| `agent:run` | Request | A permitted person | "Work this issue" (FR-003, FR-022) |
| `agent:queued` | State | Orchestrator | Trigger accepted, job pending |
| `agent:working` | State | Orchestrator | A run is active |
| `agent:waiting` | State | Orchestrator | Human decision required |
| `agent:halted` | State | Orchestrator | Stopped, feedback posted |
| `agent:finished` | State | Orchestrator | Ended successfully |
| `agent:failed` | State | Orchestrator | Ended with a failure reason |
| `agent:rejected` | State | Orchestrator | Proposal not accepted — rejected or closed without merging; no automatic retry |
| `agent:proposal` | Marker | Orchestrator | A pull request exists for this issue |

`agent:run` is a request, not a state: it stays applied across runs. Re-triggering therefore means
**removing it and adding it again** — the `issues.labeled` event only fires on the add. The
orchestrator treats a `labeled` event for a request already in a non-terminal state as a duplicate and
records it as such in the thread rather than starting a second run.

## Vocabulary mapping

The specification uses plain-language state names; the repository uses labels. This mapping is the
only permitted translation (FR-010).

| Specification wording (FR-010) | Label |
|-------------------------------|-------|
| accepted | `agent:queued` |
| in progress | `agent:working` |
| waiting for decision | `agent:waiting` |
| halted | `agent:halted` |
| finished | `agent:finished` |
| failed | `agent:failed` |
| rejected | `agent:rejected` |

## Invariants

- **I1 — One state**: at most one `agent:*` state label is present. Every state change removes the
  previous state label in the same operation as it adds the new one.
- **I2 — Label matches thread**: the state label and the newest row of the append-only state log in the
  `agent:status` comment always agree. The log is authoritative because it carries history; if they
  disagree, the log wins and the label is corrected on the next observation. Both are cross-checked
  against the label events in the issue timeline, which record actor and timestamp.
- **I3 — Terminal labels are sticky**: `finished`, `failed`, and `rejected` are only left through an
  explicit command (`retry`) or a new `agent:run` label. No automatic re-entry. Entering a terminal
  state from `waiting` is not a re-entry: it is the outcome of the human decision, recorded in the
  thread by the orchestrator when it observes the proposal being closed.
- **I4 — Acknowledgement precedes state**: `agent:queued` is set and the acknowledgement comment is
  posted before any model call, so the acknowledgement cannot be lost to a later run failure. SC-002 is
  measured from the start of the run, and the trigger-to-start delay is printed in the acknowledgement
  (SC-016).
- **I5 — Interrupted runs resolve**: a job that dies while holding `agent:working` is reconciled by the
  next observation of the issue (any event on it, or the scheduled sweep in `agent-sweep.yml`) to
  `failed` with reason `interrupted`. The sweep also repairs the one-state invariant if a previous
  process died between removing the old state label and adding the new one. No issue stays `working`
  indefinitely (FR-011).
- **I6 — Serialization**: the workflow concurrency group `agent-issue-<number>` with
  `cancel-in-progress: false` prevents simultaneous jobs for one issue (FR-013). A second trigger
  while one is pending collapses into the pending run rather than queuing twice. This serialises per
  issue only; a repository-wide cap is not expressible with concurrency groups (a single global group
  would serialise to one) and is therefore an operational expectation, not an enforced limit.

## Transition table

| From | Event | To | Notes |
|------|-------|----|-------|
| (none) | `agent:run` added | `queued` | Label actor must have write access (FR-024). This is the only path that starts new work (FR-026) |
| `queued` | job starts | `working` | Acknowledgement already posted (I4) |
| `queued` | `/agent halt` | `halted` | Cancelled before any model call |
| `working` | boundary reached with pending halt | `halted` | Feedback comment first (FR-028) |
| `working` | limit reached | `waiting` | Consumption posted; `continue` needed |
| `working` | ambiguity reported by the agent | `waiting` | Question posted in the thread (FR-006) |
| `working` | run ends, proposal created | `waiting` | Human review pending |
| `working` | run ends, no changes needed | `finished` | Result comment posted |
| `working` | job dies | `failed` | Reason `interrupted` (I5) |
| `working` | retry signal from the harness | `failed` | Reason `unexpected-retry` (FR-031) |
| `waiting` | `/agent continue` | `working` | Allowance raised if the cause was a limit |
| `waiting` | `/agent approve` | `waiting` | Approval recorded; merge remains human (FR-008) |
| `waiting` | `/agent reject` | `rejected` | Reason captured |
| `waiting` | proposal merged | `finished` | Records the merging person and time in the thread (FR-033) |
| `waiting` | proposal closed without merge | `rejected` | Same record; the thread states that the change was not applied |
| `halted` | `/agent retry` or `/agent continue` | `working` | Continues recorded state (FR-032) |
| `failed` | `/agent retry` | `working` | New run, lineage recorded |
| `rejected` | `/agent retry` | `working` | Only on explicit human request (US2 scenario 3) |

## Platform configuration

```yaml
concurrency:
  # GitHub evaluates this before any step runs, so it cannot be computed inside the job.
  # pull_request events carry the pull-request number, not the issue number.
  group: agent-issue-${{ github.event.issue.number || github.event.pull_request.number || inputs.issue }}
  cancel-in-progress: false
```

Consequences of the mechanism, stated rather than assumed:

1. **No step can compute the group.** Any wording that a first step derives the key is wrong; the
   expression above is the only available form.
2. **A pull-request event and a run may land in different groups** (same logical issue, two numbers). A
   close can therefore interleave with a running job. This is accepted because the state log is
   append-only and the label is reconciled to its newest row (I2), and because the `agent:outcome` marker
   makes a duplicate post impossible.
3. **If strict serialization is ever required**, the only correct lever is one global group
   (`group: agent-workflow`), which serializes *all* issues to one job — a scope change, not a
   configuration tweak.

`cancel-in-progress: false` remains required: cancelling mid-turn would abandon work the spec says must be
reported and would break the boundary rule (FR-027).
