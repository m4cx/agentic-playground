# Contract: Proposal (Branch and Pull Request)

**Feature**: `001-issue-driven-agent-workflow` | **Requirements**: FR-007, FR-008, FR-009, FR-018, FR-019, FR-023

The orchestrator, not the agent, turns a workspace diff into a reviewable proposal. The agent never
commits, pushes, or opens anything.

## Branch

```text
agent/<issue-number>-<slug>
```

- `<slug>`: lower-case ASCII, `[a-z0-9-]`, at most 6 words, derived from the issue title by a fixed
  English-safe transliteration. Non-Latin titles fall back to `issue-<number>` (constitution I: no
  transliterated foreign words leak into repository identifiers as prose).
- Never the default branch. A pre-existing branch for the same issue gets a `-2`, `-3` suffix rather
  than being force-pushed.
- Created from the default branch's current head at run start and recorded in the acknowledgement.

## Commit

- One commit per run. Message: `agent: <imperative summary> (#<issue>)`.
- Summary is English, at most 72 characters, derived from the agent's own English summary line; if the
  agent produced none, the fallback is `address issue <number>`.
- Author identity is the workflow identity, not a maintainer. No `Co-authored-by` lines, no model
  attribution in the message (the thread carries provenance).

## Pull request

| Field | Value |
|-------|-------|
| Title | `<agent summary> (#<issue>)` |
| Body | Result template: link to the issue, what changed and why, what was **not** done, how it was verified, and the request version it answers |
| Base | Default branch |
| Head | `agent/<issue>-<slug>` |
| Labels | `agent:proposal` |
| Reviewers | None assigned automatically — assignment is a human judgement |
| Draft | No; a draft is not reviewable, and reviewability is the point |

The issue thread post links the pull request and states the same "what a human must do next" line
(see `contracts/thread-messages.md` §4).

## Guarantees

- **No merge, ever** — the orchestrator holds no merge call at all, not merely a disabled flag
  (FR-008). Verified by a unit test asserting the client exposes no merge endpoint.
- **Approval is recorded, not applied** — `/agent approve` (or a GitHub review) records the decision
  and labels the proposal; the merge button stays human (FR-009).
- **Rejection is terminal for that proposal** — a rejected proposal is not amended or reopened
  automatically (US2 scenario 3).
- **Redaction before commit** — file contents pass through `redact.js`; a detected credential aborts
  the proposal, posts the failure enum `secret-request`, and commits nothing (FR-018).
- **Conflict** — if the default branch moved such that the proposal cannot be created cleanly, the
  run fails with `content-conflict` and the thread names the diverging paths (edge case in spec).
- **Bounded diff** — a diff larger than `config.yml#maxChangedPaths` or `#maxDiffLines` fails the run
  with `request-too-large` instead of producing an unreviewable proposal.
- **Repository-only artifacts** — the proposal contains the work, not bookkeeping: no run logs, no
  session files, no agent metadata files (spec clarification: the thread is the record).
