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
| `agent:rejected` | State | Orchestrator | Proposal rejected, no automatic retry |
| `agent:proposal` | Marker | Orchestrator | A pull request exists for this issue |

`agent:run` is a request, not a state: it stays applied across runs so that a person can re-trigger by
re-adding it, and it is removed only when someone no longer wants agent handling at all.

## Invariants

- **I1 — One state**: at most one `agent:*` state label is present. Every state change removes the
  previous state label in the same operation as it adds the new one.
- **I2 — Label matches thread**: the state label and the most recent orchestrator status comment
  always agree. If they disagree, the thread wins and the label is corrected on the next observation.
- **I3 — Terminal labels are sticky**: `finished`, `failed`, and `rejected` are only left through an
  explicit command (`retry`) or a new `agent:run` label. No automatic re-entry.
- **I4 — Acknowledgement precedes state**: `agent:queued` is set and the acknowledgement comment is
  posted before any model call, so SC-002 holds even if the run later fails.
- **I5 — Interrupted runs resolve**: a job that dies while holding `agent:working` is reconciled by
  the next observation of the issue (any event on it, or the scheduled sweep in `agent-run.yml`) to
  `failed` with reason `interrupted`. No issue stays `working` indefinitely (FR-011).
- **I6 — Serialization**: the workflow concurrency group `agent-issue-<number>` with
  `cancel-in-progress: false` prevents simultaneous jobs for one issue (FR-013). A second trigger
  while one is pending collapses into the pending run rather than queuing twice.

## Transition table

| From | Event | To | Notes |
|------|-------|----|-------|
| (none) | `agent:run` added | `queued` | Comment author/actor must have write access |
| `queued` | job starts | `working` | Acknowledgement already posted (I4) |
| `queued` | `/agent halt` | `halted` | Cancelled before any model call |
| `working` | boundary reached with pending halt | `halted` | Feedback comment first (FR-028) |
| `working` | limit reached | `waiting` | Consumption posted; `continue` needed |
| `working` | ambiguity reported by the agent | `waiting` | Question posted in the thread (FR-006) |
| `working` | run ends, proposal created | `waiting` | Human review pending |
| `working` | run ends, no changes needed | `finished` | Result comment posted |
| `working` | job dies | `failed` | Reason `interrupted` (I5) |
| `waiting` | `/agent continue` | `working` | Allowance raised if the cause was a limit |
| `waiting` | `/agent approve` | `waiting` | Approval recorded; merge remains human (FR-008) |
| `waiting` | `/agent reject` | `rejected` | Reason captured |
| `halted` | `/agent retry` or `/agent continue` | `working` | Continues recorded state (FR-032) |
| `failed` | `/agent retry` | `working` | New run, lineage recorded |
| `rejected` | `/agent retry` | `working` | Only on explicit human request (US2 scenario 3) |

## Platform configuration

```yaml
concurrency:
  group: agent-issue-${{ github.event.issue.number || inputs.issue }}
  cancel-in-progress: false
```

`cancel-in-progress: false` is required, not cosmetic: cancelling a run mid-turn would abandon work
that the spec says must be reported, and would break the boundary rule (FR-027).
