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

## Workspace trust boundary

The agent may change the work tree but must not gain control over the repository metadata the
orchestrator later executes against. When Pi runs under the egress uid (research D17):

- The work tree is owned by the egress uid, so `edit` and `write` can modify existing tracked files and
  create new ones; `node_modules/` stays read-only, so the agent cannot rewrite its own harness.
- The git directory is moved out of the work tree into a root-owned mode-`0700` `GIT_DIR`; the work tree
  contains no usable `.git`. The egress uid cannot read or write hooks, config, objects, or replace the
  entry, because the directory is outside its reach.
- Git runs with `--git-dir=<GIT_DIR> --work-tree=<repoRoot>`, `-c safe.directory=<repoRoot>`, and
  `-c core.hooksPath=/dev/null`; commits also pass `--no-verify`. These are defense in depth on top of
  the directory separation.
- The push credential is carried in the git child's environment
  (`GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_0` / `GIT_CONFIG_VALUE_0`), never in `argv` and never in the git
  config, because `/proc/<pid>/cmdline` is world-readable.
- Pi is a process-group leader; the group and any remaining process of the egress uid are killed before
  the diff is collected, so a background process started by the agent cannot edit the tree during
  commit.

A preflight probe as the egress uid must succeed on a work-tree write, fail to read or write `GIT_DIR`,
find no `.git` entry in the work tree, and fail to write under `node_modules/`; otherwise the run fails
with `environment` before the acknowledgement.

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

## Decisions and their sources

| Source | Event | Decision | Thread record |
|--------|-------|----------|---------------|
| Command | `issue_comment` starting with `/agent` | `halt`, `retry`, `continue`, `approve`, `reject` | `agent:decision` |
| Review | `pull_request_review` submitted | `approve` (approved) or `reject` (changes requested) | `agent:decision`, source `review` |
| Merge | `pull_request.closed`, `merged: true` | `merge` — the decision that lets the change take effect | `agent:outcome` and `agent:decision` |
| Close | `pull_request.closed`, `merged: false` | `close` — the change is not applied | `agent:outcome` and `agent:decision` |

Every source re-checks the actor's write access at the moment it is recorded (FR-025); a review or a
merge by a person without write access is recorded as ignored, not as a decision. Only these sources can
change `approvalState`; the agent process cannot.

## Guarantees

- **No merge, ever** — the orchestrator holds no merge call at all, not merely a disabled flag
  (FR-008). Verified by a unit test asserting the client exposes no merge endpoint.
- **The merge is the gate, `/agent approve` is a note** — no command and no review applies a change;
  only a human merge does (FR-007, FR-008). `/agent approve` records an intention in the thread and
  labels the proposal, and is never required before a merge: a missing approval command never blocks a
  merge, and an approval command never causes one.
- **Reviews are decisions** — an approving review counts as `approve`, a changes-requested review as
  `reject`; both are mirrored into the issue thread with actor and timestamp, because the thread is the
  record (FR-009).
- **Closing resolves the issue** — on `pull_request.closed` the orchestrator records whether the change
  was merged and by whom, sets the issue to `finished` (merged) or `rejected` (closed without merge), and
  appends the state row (FR-033). A branch is never reused after a close.
- **Rejection is terminal for that proposal** — a rejected proposal is not amended or reopened
  automatically (US2 scenario 3).
- **Redaction before commit** — file contents pass through `redact.ts`; a detected credential aborts
  the proposal, posts the failure enum `secret-request`, and commits nothing (FR-018).
- **No agent-controlled git surface** — `.git` is outside the agent's writable tree, hooks are disabled,
  and the push credential never appears in `argv` or `.git/config` (`contracts/pi-rpc.md` §"Privilege
  handoff and workspace ownership").
- **Conflict** — if the default branch moved such that the proposal cannot be created cleanly, the
  run fails with `content-conflict` and the thread names the diverging paths (edge case in spec).
- **Bounded diff** — a diff larger than `config.yml#proposal.maxChangedPaths` or
  `config.yml#proposal.maxDiffLines` fails the run with `request-too-large` instead of producing an
  unreviewable proposal (`contracts/config.md`).
- **Repository-only artifacts** — the proposal contains the work, not bookkeeping: no run logs, no
  session files, no agent metadata files (spec clarification: the thread is the record).
