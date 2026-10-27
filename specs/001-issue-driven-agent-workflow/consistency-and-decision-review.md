# Consistency Review and Decision Re-Evaluation

**Feature**: `001-issue-driven-agent-workflow`

**Review date**: 2026-10-26

**Constitution in force**: 2.0.0 at review time, 2.0.1 after the cleanup in §7 (Principle I: English for all generated content; this document is
English for that reason, although the review request was made in German)

**Scope reviewed**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `quickstart.md`,
`contracts/{commands,labels,thread-messages,proposal,pi-rpc}.md`,
`checklists/requirements.md`, plus the repository context that binds this feature
(`.specify/memory/constitution.md`, `AGENTS.md`, `.specify/`, `.pi/prompts/`).

**Status**: Advisory. No specification, plan, contract, or code file was modified by this review.
Findings are inputs for `/speckit.clarify` and a `plan.md` / contract revision.

---

## 1. Purpose and method

This document answers two questions:

1. Is the artifact set internally consistent and implementable as written?
2. Were the decisions it records actually the right ones, given the alternatives?

Method:

- Every functional requirement (FR-001 … FR-032) and success criterion (SC-001 … SC-015) was traced
  to at least one mechanism in `plan.md`, `data-model.md`, or `contracts/`; every mechanism was traced
  back to a requirement. Both directions produced findings.
- Every cross-artifact claim (state names, trigger names, config keys, marker names, test names,
  transition targets) was compared across all nine documents.
- Every Pi-specific claim (CLI flags, RPC commands and events, trust behaviour, session persistence,
  accounting semantics) was verified against the installed Pi 1.4.0 documentation and, where the
  documentation was ambiguous, against the packaged implementation. Evidence is in
  [Appendix A](#appendix-a-verified-pi-10-facts).
- Where the documents disagree with each other rather than with Pi, the constitution is the tie
  breaker for language and governance; for everything else the spec is authoritative over plan and
  contracts.

## 2. Summary of results

| Dimension | Result |
|-----------|--------|
| Findings | **26** — 3 blocking, 14 major, 9 minor (revision 3: all 26 fixed) |
| Blocking findings | Trigger vocabulary contradiction (F1); no terminal state for change-producing work (F2); an edit-in-place status comment cannot serve as the audit timeline (F8) |
| Research decisions re-evaluated | 13 — 5 keep, 7 keep with amendments, 1 revisit (D7, retry policy) |
| Spec clarifications re-evaluated | 5 — 4 keep with amendments, 1 revisit (Q5, no automatic retry) |
| Constitution compliance of the spec artifacts | PASS (all artifacts English, no non-English generated content) |
| Repository-level governance finding | F24 — the constitution still contains the temporary sync-impact report it says must be removed before commit |

Overall judgement: **the design is sound and unusually well argued; the weak seam is not the agent
harness but the record model.** Two of the three blocking findings come from treating labels plus one
edited comment as a complete state and audit store. The third comes from the trigger vocabulary
drifting between spec, data model, and commands. None of them requires a re-architecture; all three
require a decision, and one (F2) changes a success criterion.

## 3. Findings

### 3.1 Index

| ID | Sev. | Area | Finding | Primary fix site |
|----|------|------|---------|------------------|
| F1 | Blocking | Trigger | FR-026 says work starts *only* via the label, but retry/continue commands also start runs, and `Trigger.origin` adds a `new-issue` origin | spec FR-026, FR-031, data-model §2, plan workflows |
| F2 | Blocking | State model | Change-producing work ends in `waiting` and stays there after approval and merge; no terminal state exists for it, contradicting FR-011, US3.2, SC-003 | spec FR-011/US3/SC-003, labels.md transitions |
| F8 | Blocking | Audit record | The single status comment is edited in place and is declared the state timeline, but GitHub exposes no comment edit history | thread-messages §Rules 5, data-model §5 |
| F3 | Major | Commands | Spec fixes only four command words; the contract defines seven; `reject` appears in the Decision entity but nowhere in FR-026 | spec FR-026, Clarifications Q2 |
| F4 | Major | Approval | "Approve" is recorded but does not apply or merge, so two human gates exist; US2 says "approved … accepted" without defining which gate | spec US2, FR-007/FR-008, commands.md, proposal.md |
| F5 | Major | Permissions | US1 lets "the requester" trigger work, FR-024 requires write access; outside reporters can neither label nor command | spec US1, FR-024, Assumptions |
| F6 | Major | Injection reporting | FR-030 requires reporting ignored directives, but no channel, marker, or template exists for the agent to signal one | spec FR-030, thread-messages, pi-rpc §Events |
| F7 | Major | Config versioning | A resumed Pi session replays the persisted system prompt and tool declarations, so FR-014's "current version only" can be violated by continuity | research D5, pi-rpc §Launch, data-model §8 |
| F9 | Major | Budget | Per-issue consumption and raised allowances have no durable home; the ack promises a remaining amount before any accounting rule exists | data-model §8, thread-messages §1, research D6 |
| F10 | Major | Data model | `WorkRequest.kind` is "reported in the ack", but the ack is posted before any model call | data-model §1, labels.md I4 |
| F11 | Major | Data model | Run fields are sourced from "Orchestrator / Config / cache", which are not durable stores, contradicting the document's own premise | data-model §3 |
| F15 | Major | PR events | `pull_request_review` is a declared trigger and reviews are named as an approval source, but no contract defines their handling | plan, data-model §6, contracts |
| F16 | Major | Recovery | Invariant I5 relies on "the scheduled sweep in `agent-run.yml`", but no schedule trigger, module, or test exists | labels.md I5, plan structure |
| F18 | Major | Configuration | Config keys and the model's home are invented per document; no single schema exists | plan, data-model §8, proposal.md, commands.md, quickstart |
| F19 | Major | Retry policy | "No automatic retry at any layer" cannot be achieved with `set_auto_retry` alone; compaction/overflow retries are separate | research D7, pi-rpc §Commands |
| F23 | Major | Verification | Quickstart references `templates.test.ts`, a scenario "S0", and "one run record" — none exist in the plan | quickstart, plan test tree |
| F24 | Major | Governance | The committed constitution still carries the sync-impact report that says it must be removed before commit; it also claims "Deferred TODOs: None" while listing a deferred judgment call | `.specify/memory/constitution.md` |
| F12 | Minor | State model | The ASCII diagram draws proposal/finished/failed transitions out of `halted`; `Run.outcome` lists `halted` under "terminal states only" | data-model §3, state machine |
| F13 | Minor | Vocabulary | Spec words (accepted / in progress / waiting for decision) are never mapped to label names | spec FR-010, labels.md |
| F14 | Minor | Labels | `agent:run` "stays applied … so a person can re-trigger by re-adding it" — re-adding requires removing, which is unstated | labels.md |
| F17 | Minor | Concurrency | A "repository-wide cap of 2 concurrent jobs" is not expressible with concurrency groups; a global group gives 1 | plan §Scale, labels.md I6 |
| F20 | Minor | Latency | SC-002's 2-minute acknowledgement is posted by the run job, which concurrency can queue | labels.md I4, research open items |
| F21 | Minor | Rationale | `abort` is described as waiting instead of interrupting; the docs say it aborts the operation, *then* waits for idle | research D2, pi-rpc §Stop |
| F22 | Minor | Rationale | `get_messages` is described as building the thread digest, which actually comes from GitHub | pi-rpc §Commands |
| F25 | Minor | Egress/latency | RPC mode performs a startup model-catalog refresh (15 s) that no document accounts for; `--offline` exists | plan, pi-rpc §Launch |
| F26 | Minor | Evidence | Research D13 claims the `git` grep over `.specify/scripts/bash/*.sh` "returns nothing"; it returns two comment lines | research D13 |

### 3.2 Blocking findings in detail

#### F1 — The trigger vocabulary is contradictory

*Where*: `spec.md` FR-026, FR-031, FR-032; `data-model.md` §2 (`Trigger.origin`, "Must be one of the
three"); `contracts/commands.md` effects table; `plan.md` Target Platform (`issues`,
`issue_comment`, `pull_request_review`).

*What*: FR-026 states the system "MUST start work only in response to the repository label that marks
an issue for agent handling". The same specification then requires that `retry` starts a new run
(FR-031) and that a retry run records lineage (FR-032). `commands.md` also lets `continue` resume a
run, and `labels.md` moves `halted`/`failed`/`rejected` to `working` on command. `data-model.md` names
three origins — `new-issue`, `label`, `retry-command` — of which `new-issue` contradicts FR-026 and
which omits the `continue` path entirely. `plan.md` additionally triggers the run workflow on
`issues: opened`, which is not a label event.

*Why it matters*: FR-026 is the requirement that makes "no consequential decision depends on the agent
interpreting free text" auditable, and SC-015 audits trigger origin over 30 days. As written, the
audit will either flag legitimate retries as violations or ignore them.

*Recommendation*: restate FR-026 as exactly two entry points — (a) the `agent:run` label applied by a
permitted person starts new work, (b) `retry` / `continue` from a permitted person continues an
existing record — and make `Trigger.origin` a closed set of four values
(`label`, `retry-command`, `continue-command`, `label-at-creation`). Either drop `issues: opened` from
the run workflow trigger or define it as a pre-check that cannot start work without the label.

#### F2 — Change-producing work has no terminal state

*Where*: `spec.md` FR-011, US3 acceptance 2, SC-003; `contracts/labels.md` transition table and
terminal column.

*What*: FR-011 requires that work which ended "is not left in a non-terminal state"; US3.2 says an
ended request shows "one of the terminal states (finished, failed, or rejected)"; SC-003 demands zero
issues in a non-terminal state 24 hours after last activity. But `labels.md` moves
`working → waiting` when a proposal is created, and `waiting + /agent approve → waiting`. Nothing
transitions a proposal-carrying issue to `finished` after the merge, so the primary flow of the feature
(issue → change → review → merge) leaves the issue permanently non-terminal. `halted` is a further
edge: non-terminal by the label table, listed under "terminal states only" in `Run.outcome`.

*Why it matters*: SC-003 is the criterion that makes "nothing is silently abandoned" measurable. In the
current model it is violated by every successful change request, which means either the criterion or
the state machine will be quietly ignored — the failure mode the spec exists to prevent.

*Recommendation*: choose one of two coherent models.
(a) *Run-centric*: `waiting` is a legitimate resting state; reword FR-011 to "no run is left in
`queued`/`working`" and SC-003 to "zero issues remain in `queued` or `working` 24 hours after last
activity", and add `waiting` to US3.2's allowed states.
(b) *Issue-centric*: add `pull_request.closed` handling so merged → `finished` and closed-unmerged →
`rejected`, and keep SC-003 as written.
Recommendation: (a) plus the `pull_request.closed → finished` transition from (b), because SC-003 as
written is the more valuable promise and the transition is cheap.

#### F8 — The status comment cannot be the state timeline

*Where*: `contracts/thread-messages.md` §Markers and §Rules 5; `data-model.md` §5 and §9.

*What*: `agent:status` is "exactly one per issue … posted once, then edited on every state change",
and rule 5 says "the status comment's edit history gives the state timeline". The GitHub REST API
returns a comment's current body only; the issue timeline does not carry comment revisions, and the web
UI shows an "edited" marker without the intermediate bodies. A third party therefore cannot
reconstruct the state sequence, which FR-016 and SC-005 require.

*Why it matters*: this is the load-bearing mechanism for the "repository is the record" decision
(spec clarification Q4). If the timeline is unreadable, the reconstruction procedure in
`thread-messages.md` rule 5 fails at step one, and the alternative — workflow logs — is explicitly
excluded from the record.

*Recommendation*: keep one status comment, but make it **append-only inside the body**: each transition
appends a row (`state | timestamp | runId | consumption | next act`), never rewrites prior rows. The
body then carries the full timeline, the thread stays free of comment spam, and no edit history is
needed. Cross-check with the label events in the issue timeline (which GitHub does expose, including
actor and timestamp) instead of relying on comment revisions.

### 3.3 Major findings in detail

**F3 — Command vocabulary is incomplete in the specification.**
FR-026 names `halt`, `retry`, `continue`, `approve`; the Clarifications session repeats exactly those
four; `commands.md` defines seven (`+ reject`, `status`, `help`); the `Decision` entity includes
rejection. Recommendation: FR-026 names the closed decision set `{halt, retry, continue, approve,
reject}` and states that `status` and `help` are informational and never change state. Correct the
Clarifications wording so the record does not contradict the requirement.

**F4 — "Approve" has no defined effect.**
`commands.md`: `approve` "records the approval decision in the thread and marks the proposal approved.
**Does not merge**". `proposal.md`: "Approval is recorded, not applied". So the real gate is the merge
button, which no requirement mentions, and US2 scenario 4 ("Given an approved proposal, When it is
accepted") never defines "accepted". Three coherent options:

| Option | Gate | Consequence |
|--------|------|-------------|
| A. Merge is the only gate (recommended) | GitHub review + merge | Matches FR-008 literally, matches branch protection, `/agent approve` is bookkeeping only. Requires the state transition from F2 and a requirement that the merge actor/commit is recorded in the thread |
| B. `/agent approve` enables auto-merge | Command | Contradicts FR-008 ("never merge … on its own initiative") unless "initiative" is reworded; also defeats branch protection |
| C. Two gates as today | Command + merge | Nothing wrong in principle, but must be documented as two distinct decisions with two records, and US2/FR-007 must say so |

Option C is defensible but currently undocumented, which is why it reads as an inconsistency rather
than a design.

**F5 — Who is allowed to start work is narrated differently than it is specified.**
US1: "A requester … signals that the agent should work on this issue"; SC-006: zero people need local
tooling. FR-024: only write access and above may start. On GitHub, applying a label needs triage or
write, and a triage-only account can label but is then refused by FR-024. So either the "requester"
must have write access (making US1's narrative misleading), or the permission model should admit
triage for triggering and reserve approval for write. Recommendation: keep FR-024 as the security
model, and add one sentence to US1/Assumptions: "A requester without write access asks a permitted
person to apply the label; the agent records the label actor, not the issue author, as the trigger."
Alternatively run a decision on whether triage may trigger. This is a product decision, not a defect
in the design.

**F6 — The "ignored directive" report has no channel.**
FR-030 requires the system to state in the thread which embedded directive was ignored and why;
SC-014 measures it over 10 hostile issues. `data-model.md` V7 says "ignored directives are reported by
the orchestrator when the agent signals one, and by the standing instruction otherwise" — but no
signal is defined, no marker exists in `thread-messages.md`, and `pi-rpc.md` has no event for it. The
orchestrator therefore cannot distinguish "no directive found" from "the agent stayed silent".
Recommendation: define a required, machine-checkable section in the agent's final message (for example
a fenced `agent-ignored:` list) that the orchestrator parses and renders into a new `agent:notice`
template; add the negative case ("no directives found") so absence is distinguishable from a parse
failure; add it to SC-014's test procedure.

**F7 — Session continuity can violate "current instructions only".**
Pi persists the system prompt sections and the tool loadout in the session file
(`docs/session-format.md` §Entries: "System messages carry the prompt and tool loadout … later changes
patch `sections` by name and list `toolsAdded`/`toolsRemoved`"). A resumed session for issue N reuses
the persisted prompt and tools from the run that created it. FR-014 requires that changed standing
instructions apply to new work, and D3 claims the tool allowlist is a hard boundary. If
`.agent/instructions.md` or `config.yml#tools` changes between runs, a resumed session can carry the old
sections and can replay a tool that is no longer allowed. Recommendation: include the instructions SHA,
the tool allowlist hash, `piVersion`, and `modelId` in the session cache key; on mismatch start a fresh
session and inject the thread digest (the D5 fallback already exists); assert the effective tool list
via `get_state` at run start and fail the run if it exceeds the allowlist.

**F9 — Consumption and allowance have no durable home.**
The spec forbids per-run record files and a database; the ack template promises "Allowance for this
issue: `<remaining>` of `<cap>`"; `data-model.md` derives consumption from `get_session_stats`, which Pi
reports as session-lifetime totals (`docs/rpc-commands.md` §get_session_stats: "across the full
session"). Consequences: (a) if the cache is evicted, the cumulative number resets, so the per-issue cap
silently resets with it; (b) the raised allowance from `/agent continue` exists only as prose in a
decision comment, with no defined parse rule. Recommendation: state the accounting rule explicitly — cap
= configured `maxCostUsd` + sum of increments recorded in `agent:decision` comments; consumed = last
session statistics + the consumption recorded in prior `agent:result`/`agent:limit` comments; cache loss
is shown as "accounting restarted at this run"; and stop promising a remaining amount in the ack before
the rule exists.

**F10 — `kind` is classified after the message that reports it.**
`data-model.md` §1: `kind` is "derived from the agent's own classification, reported in the ack". The
ack is posted before any model call (I4, SC-002), so no classification exists yet, and the ack template
has no field for it. Recommendation: classify at the first action boundary, publish it in the status
comment (`Request type: change | answer`), and drop the promise from the ack.

**F11 — The data model does not say where run fields physically live.**
The document's stated purpose is to record "where each field physically lives", but most `Run` fields
have `Source: Orchestrator`, `Config`, or `cache`, none of which is durable. Given FR-016 and SC-005,
each field needs a durable artifact: `runId` and `state` in the `agent:status` marker/body, `startedAt`
in the ack, `instructionsVersion`/`piVersion`/`modelId` in the ack, `consumption` in the status body,
`continuesRunId` in the status body, `failureReason` in `agent:error`, `outcome` in `agent:result`.
Recommendation: add a "durable artifact" column and make it non-empty for every field that a third
party must reconstruct.

**F15 — Pull-request reviews are a declared trigger without a handler.**
`plan.md` lists `pull_request_review` among the workflow triggers; `data-model.md` §6 gives
`approvalState` the source "Reviews + `/agent approve`/`reject`"; `proposal.md` says "or a GitHub review"
records the decision. Nothing defines which review states count, how a review by a non-write account is
handled (FR-024/FR-025), or how the decision reaches the thread (FR-009 requires the thread to carry
it). Recommendation: add a short contract section mapping `pull_request_review` states
(`approved` → decision `approve`, `changes_requested` → `reject`) and `pull_request.closed`
(`merged: true` → terminal, see F2) to thread messages, with the same permission re-check, and decide
whether a review and a command are equivalent or whether one mirrors the other.

**F16 — The reconciler has no trigger, module, or test.**
Invariant I5 promises that a job which dies while holding `agent:working` is reconciled "by the next
observation … or the scheduled sweep in `agent-run.yml`". The plan's workflow comment is
"issues: opened/labeled", the target platform lists only `issues`, `issue_comment`,
`pull_request_review`, and `src/agent/` has no reconcile module. Data-model V3 nonetheless depends on
"a watchdog". Recommendation: add a `schedule:`/`workflow_dispatch` sweep (either in `agent-run.yml` or
a separate `agent-sweep.yml`), a `reconcile.ts`, a definition of the sweep window, idempotency with
normal event handling, and a test.

**F18 — Configuration keys are invented per document.**
Keys referenced in the contracts but absent from the plan's `.agent/config.yml` description:
`globalHaltIssue` (commands.md), `maxChangedPaths`, `maxDiffLines` (proposal.md), `warnAtRatio`,
`continueIncrementUsd`, `maxTurns`, `maxWallClockMinutes` (data-model §8), start deadline (pi-rpc).
Conversely the plan mentions label names, timeouts, and a concurrency cap that the data model does not
schema. The model's home is also split: D12 pins the model ID in `.agent/config.yml`, `pi-rpc.md`
passes `--model "$AGENT_MODEL"`, `--thinking "$AGENT_THINKING"`, and `quickstart.md` stores
`AGENT_MODEL` as a repository secret. Recommendation: publish one config schema (a `contracts/config.md`
or a single table in `data-model.md`) and reference it from everywhere else; decide whether the model
ID is reviewable content (D12) or an environment value, and if both, define precedence. Provider keys
should remain the only secrets.

**F19 — "No automatic retry at any layer" is only partly implementable.**
`set_auto_retry {enabled:false}` disables transient-error retries. Pi separately performs
context-overflow recovery and compaction retries (`summarization_retry_scheduled`,
`agent_end.willRetry`, `compaction_end.willRetry`), and exposes `set_auto_compaction`. The
`pi-rpc.md` contract treats only `auto_retry_start` as a violation, so an overflow-recovery retry would
increase spend without being counted as an attempt, which is exactly what the clarification wanted to
prevent. Recommendation: either disable automatic compaction (`set_auto_compaction {enabled:false}`)
and accept that long runs fail, or define overflow recovery as a recorded attempt; add
`summarization_retry_scheduled` and `willRetry` to the contract's violation signals either way.

**F23 — The verification guide references artifacts that do not exist.**
`quickstart.md` requires `tests/unit/templates.test.ts`, which the plan's test tree does not list (the
plan lists `messages.test.ts` instead); S2 cites "unit test S0" and there is no S0; S9 asks for "one Pi
session and one run record", contradicting the decision that no run-record files are created. Also
missing: tests for the reconciler (F16), for PR-review decisions (F15), and for the trigger vocabulary
(F1). Recommendation: align quickstart with the plan's test tree, or extend the plan; replace "run
record" with "run markers in the thread"; add the missing negative tests.

**F24 — Constitution hygiene (outside this feature, but it governs it).**
`.specify/memory/constitution.md` still contains the `Sync Impact Report` block whose own closing note
says it "MUST be removed before the amended constitution is committed" — and it is committed. The same
block says "Deferred TODOs: None" while listing a judgment call to confirm. Per the constitution's
governance section this is an editorial (PATCH) cleanup, not a principle change. Recommendation: remove
the report in a separate editorial commit; do not couple it to this feature.

### 3.4 Minor findings

| ID | Finding | Recommendation |
|----|---------|----------------|
| F12 | The ASCII state diagram routes "proposal produced", "run ended successfully", and "run failed" out of `halted` rather than `working`; the transition table below it is correct. `Run.outcome` lists `halted` under "terminal states only" while the label table marks it non-terminal | Redraw the diagram from the transition table; remove `halted` from the terminal-only list or add an explicit note that a halted run is terminal while its issue is not |
| F13 | Spec vocabulary ("accepted, in progress, waiting for decision") never maps to label names | Add a mapping table (accepted → `agent:queued`, in progress → `agent:working`, waiting for decision → `agent:waiting`, …) |
| F14 | `agent:run` "stays applied across runs so that a person can re-trigger by re-adding it" — re-adding requires removing it first, which is unstated and untested | State the remove-then-add procedure, or have the orchestrator accept a `/agent run` command as the re-trigger path |
| F17 | "A repository-wide concurrency cap of 2 concurrent agent jobs" is not achieved by per-issue concurrency groups; a single global group serialises to one | Drop the number or state it as an operational assumption; if a real cap is needed, say which mechanism enforces it |
| F20 | SC-002's 2-minute acknowledgement is posted by the run job (I4), which a concurrency group can queue behind another issue | Either post the ack from a second, concurrency-free workflow, or reword SC-002 to "within 2 minutes of the run starting" plus a separate queue-latency measure |
| F21 | `abort` is described as waiting for idle "instead of killing a tool mid-flight"; the docs say it aborts the current operation and then waits for idle | Correct the rationale; the behaviour is still correct because abort is only sent after `turn_end`. Add: no steering/follow-up may be queued at abort time, because `abort` continues queued messages |
| F22 | `get_messages` is described as building the thread digest, which actually comes from GitHub | Split the rows: thread digest from the issue thread; `get_messages` only to reconstruct what the previous Pi session saw |
| F25 | RPC mode refreshes the model catalog at startup (bounded by 15 s) and Pi may refresh elsewhere; no document accounts for that latency or egress | Consider `--offline` with pinned models, and include the startup call in the start deadline |
| F26 | D13 states that `grep -n "git " .specify/scripts/bash/*.sh` "returns nothing" to prove Spec Kit does no git work; the grep actually returns two comment lines in `common.sh` (37, 78). The conclusion still holds, but the stated evidence is wrong | Change the claim to what is verifiable: no script invokes git; the only mentions are comments about an absent hook extension |

## 4. Decision re-evaluation

Each block restates the decision, names the alternatives that were available (including ones the
research did not consider), weighs the chosen option, and gives a verdict:

- **KEEP** — sound as decided.
- **KEEP + AMEND** — sound core, but a defect must be fixed.
- **REVISIT** — the decision is defensible but its stated justification does not survive, or the
  chosen option is dominated.

### D1 — Ephemeral GitHub-hosted runner

**Taken**: `ubuntu-24.04` runner started by workflow events; nothing runs on a contributor machine.

**Alternatives**: (a) self-hosted runner; (b) long-lived container app or VM with a webhook ingress;
(c) hosted runner plus a separate lightweight acknowledgement workflow; (d) serverless function
orchestrating a container job.

**Pros (chosen)**: no infrastructure to own or patch; ephemerality is the cheapest isolation
available; the event that carries the trigger also starts the compute; no long-lived credential host;
cost is per run.

**Cons (chosen)**: queue latency directly threatens SC-002; 6-hour job ceiling; no warm state between
runs, so every run pays checkout and model warm-up; the platform's event and permission model becomes
a hard dependency; no ability to serve an interactive "status" without a job.

**Re-evaluation**: **KEEP**, with (c) as a named escape hatch. If SC-002 is to remain a measured
promise, the acknowledgement should not depend on a queued job (F20). Long-lived hosting (b) buys
latency and warm state but adds a public ingress, a deploy target, and a process that holds a
repository token between runs — a strictly worse security posture for a workflow whose entire threat
model is "untrusted text reaches the agent".

### D2 — RPC mode as the harness integration

**Taken**: `pi --mode rpc`, driven over the documented JSONL protocol (`RpcClient` available).

**Alternatives**: (a) print mode; (b) JSON mode; (c) in-process TypeScript SDK; (d) RPC with a
protocol-version assertion and a fallback to print mode for answer-only requests.

**Pros (chosen)**: bidirectional control is genuinely required — cumulative cost inspection
(`get_session_stats`), boundary stop (`abort`), retry control (`set_auto_retry`,
`set_auto_compaction`), and session continuity (`--session-id`) are all absent from print and JSON
modes; process isolation keeps a Pi crash from taking the orchestrator with it.

**Cons (chosen)**: coupling to a wire protocol rather than a stable API; two processes to supervise on
a shared host with no authentication between them (anything on the runner can talk to Pi's stdin);
the documented semantics are subtle (see F21/F22), which is where the current rationale is wrong.

**Re-evaluation**: **KEEP**. The alternative with real merit is (c), the SDK, but it trades a
documented boundary for in-process coupling and collapses the isolation that makes the design
reviewable. Correction needed: fix the abort rationale and add the "no queued steering" rule.

### D3 — Explicit, trust-disabled configuration surface

**Taken**: `--no-approve`, `--no-extensions`, `--no-skills`, `--no-mcp`, `--no-prompt-templates`,
explicit instruction file, explicit tool allowlist.

**Alternatives**: (a) idiomatic `.pi/APPEND_SYSTEM.md` + `--approve`; (b) instructions baked into the
workflow YAML; (c) rely on `AGENTS.md` alone; (d) a container with a read-only, curated `.pi/`.

**Pros (chosen)**: behaviour becomes a function of one reviewed Markdown file plus one argument list;
the branch cannot inject tools or MCP servers; configuration changes appear as reviewable diffs.

**Cons (chosen)**: two configuration surfaces (instruction file + config + CLI arguments) that can
drift; a future maintainer expecting `.pi/SYSTEM.md` to work will be surprised; context files
(`AGENTS.md`) still load and are repository content the agent must reason about; verified
implementation detail: an explicit `--prompt-template` path under `.pi/` still loads with
`--no-approve` (trust gates discovery, not explicit paths), which is convenient but is an undocumented
interaction to rely on.

**Re-evaluation**: **KEEP + AMEND**. The interaction in the last point is verified today
(`dist/core/resource-loader.js` merges `additionalPromptTemplatePaths` unconditionally) but is not
stated as a guarantee in Pi's user docs; either move the allowlisted templates to a non-trust-gated
path (for example `.agent/prompts/`) or pin the behaviour with a startup assertion that the expected
commands exist.

### D4 — Labels as the state machine

**Taken**: `agent:*` labels carry state; the label is the trigger; a concurrency group serialises.

**Alternatives**: (a) comments only (state read from the newest status comment); (b) GitHub Projects
v2 board with a status field; (c) an external key-value store or database; (d) labels for visibility
plus an append-only state log in the thread as the authority.

**Pros (chosen)**: repository-native, permission-gated, visible in the issue list without opening the
thread, and one artifact serves trigger, state, and filtering.

**Cons (chosen)**: state changes are two API calls (remove old, add new), so invariant I1 is not
atomic and a crash between calls leaves two state labels; humans can relabel; labels cannot express
history; a label change is an event, but the contract does not use the label event stream as its
timeline.

**Re-evaluation**: **KEEP + AMEND**. Labels are the right *visible* signal and the right trigger;
they are the wrong *authority*. Make the append-only thread state log authoritative (F8) and reconcile
labels to it (which inverts I2 as currently written — it says the thread wins, but the thread currently
has no timeline to win with). Also state how a half-applied label change is repaired.

### D5 — Session continuity through a cache

**Taken**: per-issue Pi session file cached with the platform cache action, thread digest as fallback.

**Alternatives**: (a) thread-only reconstruction every run; (b) sessions committed as repository files;
(c) workflow artifacts; (d) session cache keyed on issue *and* configuration fingerprint.

**Pros (chosen)**: preserves full working context cheaply, which is what SC-013 ("resume without
repeating a completed step") asks for; caches are evictable without corrupting the record.

**Cons (chosen)**: cache scope and eviction are platform behaviour, not a contract; a restored session
carries the *old* system prompt sections, tool loadout, and cost totals (F7, F9); a stale session may
also carry a stale understanding of the request version; the fallback path (thread digest) is the one
that actually guarantees the spec's promises, so the primary path is an optimisation of a mechanism
that must work anyway.

**Re-evaluation**: **KEEP + AMEND**. Add the configuration fingerprint to the cache key and assert the
effective tool list at start. Consider making the thread digest the *primary* context and the session a
pure optimisation, which is closer to the spec's intent and removes an entire class of "which version
of the rules was this run under?" ambiguity.

### D6 — Consumption measured from session statistics

**Taken**: `get_session_stats` per boundary; soft warning; hard stop; `continue` raises the allowance
by an increment.

**Alternatives**: (a) wall-clock timeout only; (b) provider-side budget keys; (c) turn counting; (d)
per-run budget with no carry-over.

**Pros (chosen)**: the number is the harness's own accounting, not an estimate; measuring per turn means
a resumed run keeps counting; the stop is explicit rather than a silent kill, matching FR-017.

**Cons (chosen)**: Pi reports *session-lifetime* totals, so per-run figures require differencing and
per-issue figures require a durable carry-over that does not exist (F9); a cache eviction silently
resets the counter; allowance increments live only in prose; "cost" is provider-dependent and may be
zero for local models, making a USD cap meaningless in some deployments.

**Re-evaluation**: **KEEP + AMEND**, and add a token-based secondary limit so the cap works even when
cost reporting is absent. The alternatives are all worse: wall clock does not bound spend, provider
keys hide the number from the thread, and turn counting is a weak proxy.

### D7 — No retry at any layer

**Taken**: the orchestrator never retries; Pi's transient-error retry is disabled.

**Alternatives**: (a) one retry for transient errors, recorded as an attempt; (b) retry only inside a
run, invisibly; (c) retry only when the failure is provably pre-model (auth, checkout, network);
(d) no retry plus `set_auto_compaction {enabled:false}` so no implicit retry exists at all.

**Pros (chosen)**: the recorded attempt count and recorded cost stay truthful; a transient provider
error costs one human command word rather than an invisible spend; it is the literal reading of the
clarification.

**Cons (chosen)**: the decision does not actually achieve its stated goal, because overflow recovery
and compaction retries remain and are not counted (F19); availability suffers for the most common
failure class in practice; the workflow will generate "please retry" traffic for noise.

**Re-evaluation**: **REVISIT**. The principle worth keeping is "no *unrecorded* retry", not "no retry".
Recommended restatement: every automated retry that can occur inside a run must be either disabled or
counted as an attempt and reflected in the thread; a single bounded transport retry with a recorded
attempt number is compatible with the clarification's purpose (no silent multiplication of
consumption) and removes the main availability cost. If the product owner keeps the strict reading,
then (d) is mandatory — otherwise the requirement is false.

### D8 — Repository authentication with the workflow token

**Taken**: platform workflow token, minimal permissions, exists only in the orchestrator.

**Alternatives**: (a) GitHub App installation token; (b) a fine-grained PAT in secrets; (c) a deploy
key limited to one branch; (d) App token from the first version, with the workflow token only as a
bootstrap.

**Pros (chosen)**: short-lived, repository-scoped, revoked with the job, no per-person credential, and
it is the only credential that needs no new infrastructure.

**Cons (chosen)**: the token inherits the workflow's permission set for the whole job, so the
orchestrator's own compromise (for example through a redaction or template-injection bug) has full
`contents: write` for the duration; the actor in the audit trail is a bot, not a stable app identity;
`contents: write` also permits pushing to any unprotected branch.

**Re-evaluation**: **KEEP**. (a) is genuinely better and the research already frames it as a drop-in
replacement; the honest statement is that the current token is a first-version trade-off, not the
target. Recommend keeping (d) as the documented next step and noting the unprotected-branch permission
in the threat model.

### D9 — Hand-rolled REST client over `fetch`

**Taken**: a thin internal client for roughly ten endpoints.

**Alternatives**: (a) `@octokit/rest`; (b) shelling out to `gh`; (c) plain `fetch` now, octokit when
the surface grows.

**Pros (chosen)**: no supply-chain surface in the one process that holds the token; (at the time of
this assessment) no build step — no longer true since revision 4, which introduced TypeScript;
unit-testable against recorded responses; explicit request shaping.

**Cons (chosen)**: pagination, conditional requests, secondary rate limits, and review-state edge
cases are easy to get wrong; the endpoint surface is already larger than "ten" once F2, F8, F15, and
F16 are implemented (timeline, events, reviews, checks); maintenance cost lands on this repository.

**Re-evaluation**: **KEEP**, with an explicit threshold: if the endpoint list exceeds roughly a dozen
or if review/merge-state handling grows, adopt octokit. The security argument for minimal
dependencies is valid, but hand-rolled pagination is itself a correctness risk in the audit path.

### D10 — Three-layer secret handling

**Taken**: (a) no repository credential in Pi's environment; (b) redaction on the way out; (c)
`persist-credentials: false` plus a per-job push credential added and removed by the orchestrator.

**Alternatives**: (a) redaction only; (b) remove the token from the environment only; (c) also run Pi
without network egress (container or firewall rules); (d) layer (c) plus a read-only mount of the
workspace for the agent process.

**Pros (chosen)**: layer (a) removes the opportunity rather than the symptom; (c) closes the concrete
`.git/config` hole; the ordering (redact on the way out, never on the way in) keeps the agent's
understanding of the request intact.

**Cons (chosen)**: the agent still has `bash` and network egress, so the *provider key* it legitimately
holds can be exfiltrated by a hostile instruction, and the workspace can be read out; redaction is a
denylist against an adversarial model; no layer covers egress at all.

**Re-evaluation**: **KEEP + AMEND**. FR-018's scope ("no secret in thread or committed content") is
narrower than the real risk, and the plan should say so rather than imply the agent is
containment-hardened. Concrete amendment: use `--offline` (or block egress for the Pi process), state
in `pi-rpc.md` that network egress is an accepted residual risk, and consider a read-only workspace
except for the paths the agent may edit.

### D11 — The orchestrator owns commits, branches, and pull requests

**Taken**: Pi produces a filesystem diff; the orchestrator redacts, commits, pushes, and opens the PR.

**Alternatives**: (a) give Pi a scoped credential and let it run `git`/`gh`; (b) upload a patch and post
it as a comment; (c) let Pi commit locally and have the orchestrator only push.

**Pros (chosen)**: one auditable step between model output and repository history; the diff is
inspected and redacted before it becomes history; the credential boundary stays intact; fixed English
commit and PR text satisfies the constitution.

**Cons (chosen)**: the agent cannot do legitimate git work (multiple commits, rebases, branch
switching, conflict resolution), which pushes some plausible requests out of scope; the orchestrator
must implement diff classification and bounded-diff rules that a real git client gives for free; one
commit per run makes large proposals coarse to review.

**Re-evaluation**: **KEEP**. (a) moves repository authority into the process that hostile issue text can
steer, which is the one thing this design refuses to do. The loss of multi-commit workflows is a real
scope limitation and should be listed as such (it currently is not).

### D12 — Pinning the Pi version and the model

**Taken**: exact Pi version, model ID in `.agent/config.yml`.

**Alternatives**: (a) floating minor/patch ranges; (b) model alias instead of an exact ID; (c) exact
pin plus a canary job that runs the test suite against the next version before the pin moves.

**Pros (chosen)**: behaviour changes become reviewable diffs; SC-005 reconstruction assumes the record
means the same thing later; upgrades are a deliberate act.

**Cons (chosen)**: no automatic security patches; upgrade toil; the model ID's location is now
ambiguous across documents (F18), which is exactly the drift pinning is supposed to prevent.

**Re-evaluation**: **KEEP + AMEND**. Pick one home for the model and thinking level, record both per
run (the ack already does), and add (c) as the upgrade procedure so pinning does not become stagnation.

### D13 — Spec Kit prompt templates from an explicit allowlist

**Taken**: `--no-prompt-templates` plus one `--prompt-template` per allowlisted path; default allowlist
is `.pi/prompts/speckit.*.md`.

**Alternatives**: (a) mention the paths in the instruction file and let the agent `read` them; (b)
enable project discovery (`--approve`) and rely on review; (c) leave the templates unreachable; (d)
allowlist templates copied into a non-trust-gated `.agent/prompts/` directory.

**Pros (chosen)**: reuses the repository's reviewed workflow vocabulary instead of re-deriving it in
prose; argument substitution works; no executable configuration is loaded; the agent's command surface
cannot drift without a config diff; verified that explicit template paths load even with trust
declined and discovery disabled.

**Cons (chosen)**: a template is inert only until a future template contains a hook or a script call —
the safety argument is about today's files, not the mechanism; a slash command the agent invokes but
that is not allowlisted silently becomes plain text, which is a confusing failure mode for the agent;
the interactive template flow (clarify) is mapped onto `waiting` without a defined resume contract
beyond `/agent continue`; "small fixes are made directly" is enforced only by an instruction, not by
anything the orchestrator checks; and the verification quoted for "no git side effects" is wrong as
written (F26), even though its conclusion holds.

**Re-evaluation**: **KEEP + AMEND**. Move the allowlist to a trust-independent path (d) or add a
startup assertion, as in D3. Add the guard that a `/speckit.*` invocation naming a non-allowlisted
template must be reported as an ignored directive with the available command list (this also gives F6
a concrete first use). Replace "templates are inert" with the narrower, true statement: "templates
produce prompts, not tools, and the repository has no Spec Kit hooks or git scripts today".

### Spec clarifications

| Clarification | Verdict | Note |
|---------------|---------|------|
| Q1: write access may start, halt, approve | KEEP + AMEND | Security model is right; US1's narrative and SC-006 must be reconciled with it (F5) |
| Q2: label starts work; fixed command words | KEEP + AMEND | Correct instinct, incomplete vocabulary in the requirement, and "label only" contradicts retry/continue (F1, F3) |
| Q3: issue content is data, not instructions | KEEP + AMEND | Strongest decision in the set; needs the reporting channel it currently lacks (F6) |
| Q4: the thread is the durable record; no run-record files | KEEP + AMEND | Right value judgement, but the record is currently not reconstructable (F8, F9, F11) |
| Q5: no automatic retry | REVISIT | Purpose (no silent spend multiplication) is right; the literal rule is not enforceable and hurts availability (F19, D7) |

## 5. Scorecard

Historical record of the assessment made before the maintainer's decisions; §7 states what was adopted.

| Decision | Verdict | Required change |
|----------|---------|-----------------|
| D1 Ephemeral runner | KEEP | Add an acknowledgement path independent of the run queue, or relax SC-002 (F20) |
| D2 RPC mode | KEEP | Correct the abort rationale; forbid queued steering at abort (F21) |
| D3 Explicit config, trust off | KEEP + AMEND | Pin the template-loading behaviour with an assertion or move templates out of `.pi/` |
| D4 Labels as state | KEEP + AMEND | Thread becomes the authority; labels reconcile to it (F8) |
| D5 Session cache | KEEP + AMEND | Configuration fingerprint in the cache key; assert tool loadout (F7) |
| D6 Cost accounting | KEEP + AMEND | Define the durable allowance rule; add a token limit (F9) |
| D7 No retry anywhere | REVISIT | Count or disable every implicit retry (F19) |
| D8 Workflow token | KEEP | Document App token as the next step and the unprotected-branch permission |
| D9 Hand-rolled client | KEEP | Adopt octokit when the endpoint surface grows |
| D10 Secret handling | KEEP + AMEND | State egress as residual risk; consider `--offline` and a read-only workspace |
| D11 Orchestrator owns git | KEEP | Record the loss of multi-commit workflows as an explicit scope limit |
| D12 Pinning | KEEP + AMEND | One home for model and thinking level; add a canary upgrade path |
| D13 Spec Kit allowlist | KEEP + AMEND | Non-trust-gated path or startup assertion; report non-allowlisted commands (F6) |

## 6. Recommended next actions

Historical record of the assessment made before the maintainer's decisions; §7 states what was adopted. Items 1-3 are the blocking decisions and should go through
`/speckit.clarify` before the contracts are revised.

1. **Decide the trigger vocabulary** (F1, F3). Amend FR-026 to the two entry points and the closed
   command set; make `Trigger.origin` a four-value enum; align the workflow triggers.
2. **Decide the end-of-life of a proposal** (F2, F4). Choose run-centric or issue-centric terminal
   semantics; add `pull_request.closed → finished|rejected`; define which gate is the merge gate;
   reword SC-003 and US3.2 accordingly.
3. **Decide how the audit timeline is stored** (F8). Make the status comment append-only in its body
   (or add per-transition state records), and stop relying on comment edit history.
4. Update the data model (F10, F11, F12, F13): classification at the first boundary, a durable-artifact
   column for every Run field, a corrected diagram, a spec-to-label mapping.
5. Update the contracts (F6, F9, F15, F16, F18, F21, F22): ignored-directive channel and template,
   allowance accounting rule, PR-review handling, reconciler trigger/module/test, one config schema,
   corrected abort and `get_messages` descriptions.
6. Update `research.md` (D5, D7, D10, D13) so the stated rationales match the verified Pi behaviour and
   the residual risks are named.
7. Update `quickstart.md` and the plan's test tree (F23), including negative tests for the three
   blocking findings.
8. Fix the constitution's leftover sync-impact report in a separate editorial commit (F24).
9. Product decisions still open (owner: maintainer): whether triage may trigger work (F5); whether a PR
   review and `/agent approve` are equivalent (F4/F15); whether a single bounded transport retry is
   acceptable (D7); whether SC-002 stays a promise or becomes a metric (F20).

## 7. Resolution status

### Revision 2 — decisions taken by the maintainer

The maintainer answered the open questions on 2026-10-26. Answers are recorded in `spec.md`
§Clarifications ("Session 2026-10-26 (consistency review resolution)").

| Question | Answer | Effect |
|----------|--------|--------|
| Retry policy | Strict: no automatic retry at any layer | `set_auto_compaction` disabled, retry signals abort and fail the run as `unexpected-retry` (FR-031, research D7) |
| End state of a proposal | Both: `waiting` is a resting state, and a closed pull request always resolves the issue | New FR-033, close transitions in `labels.md`, `agent:outcome`, `agent-proposal.yml`; FR-011, SC-003 and US3.2 reworded |
| `/agent approve` | Bookkeeping only; the merge is the decision | `commands.md` rule 7, `proposal.md` guarantees |
| Pull-request reviews | Count as approve/reject and are mirrored into the thread | `proposal.md` §"Decisions and their sources", review decisions in the data model |
| Ignored directives | Machine-verifiable block at the end of the agent's answer | `thread-messages.md` §9, `directive-report.ts`, research D14 |
| Consumption across sessions | Every session documented separately; per-issue total is their sum | New Continuity Session entity, `agent:session` message, `session-accounting.ts`, research D6 |
| Network egress | Restricted to the model provider endpoint | New FR-034, `network.allowHosts`, `agent-egress.sh`, `--offline`, research D10 |
| Constitution cleanup | Yes, remove the leftover sync-impact report | `.specify/memory/constitution.md` 2.0.0 → 2.0.1, report removed |
| Acknowledgement latency | Keep the promise inside the workflow's control: measure from run start and record the queue delay | SC-002 reworded, new SC-016, queue delay in the acknowledgement template (finding F20) |

Two implementation choices inside those answers are worth knowing, because the maintainer did not spell
them out:

1. **A missing directive report does not fail the run.** It is recorded in the thread as "no directive
   report was produced" plus a state-log note. The alternative — failing every run whose model forgets a
   formatting rule — was judged too brittle; the security claim stays auditable either way, because
   absence is visible. A directive the agent *followed* is still a failure.
2. **The constitution bump is PATCH (2.0.1).** Only a non-normative scratch block was removed; no
   principle, constraint, or workflow sentence changed.

### Final status

| ID | Status | Where it landed |
|----|--------|-----------------|
| F1 | Fixed | `spec.md` FR-026, `data-model.md` `Trigger.origin`/`event`, `labels.md` transition table |
| F2 | Fixed | FR-011, SC-003, US3.2, `labels.md` close transitions, `data-model.md` state machine, FR-033 |
| F3 | Fixed | FR-026 vocabulary, clarification note, `commands.md` decision/informational split |
| F4 | Fixed | US2.4, `commands.md` rule 7, `proposal.md` guarantees |
| F5 | Fixed | US1 narrative and independent test |
| F6 | Fixed | FR-030, `thread-messages.md` §9, `directive-report.ts`, research D14 |
| F7 | Fixed | `pi-rpc.md` §Continuity, `config.md` §Rules 5, `data-model.md` `fingerprint`, research D5, `quickstart.md` S14 |
| F8 | Fixed | `thread-messages.md`, `data-model.md` §5/§10, `labels.md` I2, `state-log.ts` + test |
| F9 | Fixed | Continuity Session entity, `agent:session`, `session-accounting.ts`, `pi-rpc.md` §Session accounting |
| F10 | Fixed | `data-model.md` `kind`, `thread-messages.md` §1/§2 |
| F11 | Fixed | `data-model.md` durable-artifact column |
| F12 | Fixed | `data-model.md` state machine and `outcome` row |
| F13 | Fixed | `labels.md` §Vocabulary mapping |
| F14 | Fixed | `labels.md` request-label lifecycle |
| F15 | Fixed | `proposal.md` §"Decisions and their sources", `agent-proposal.yml` |
| F16 | Fixed | `agent-sweep.yml`, `reconcile.ts`, tests, `labels.md` I5 |
| F17 | Fixed | `plan.md` scale/scope, `labels.md` I6 |
| F18 | Fixed | `contracts/config.md`, referenced everywhere; env overrides removed |
| F19 | Fixed | `set_auto_compaction`, retry-signal detection, failure enum `unexpected-retry`, research D7 |
| F20 | Fixed | SC-002 reworded to "within 2 minutes of the run starting", new SC-016 for the recorded queue delay, acknowledgement template and `labels.md` I4 updated, research "Open items" updated |
| F21 | Fixed | `research.md` D2, `pi-rpc.md` commands and stop sequence |
| F22 | Fixed | `pi-rpc.md` `get_messages` row |
| F23 | Fixed | `quickstart.md` test list and scenarios, `plan.md` test tree |
| F24 | Fixed | `.specify/memory/constitution.md` 2.0.1 |
| F25 | Fixed | FR-034 and the egress contract (research D10) |
| F26 | Fixed | `research.md` D13 property 2 |

### The acknowledgement-latency question, resolved (F20)

The maintainer chose to make the promise honest rather than add a second writer. The reasoning matters
for the record: a first job that posts the acknowledgement before the run would only remove the
same-issue serialization delay. It would not remove the platform's runner queue, which no mechanism inside
Actions controls, and it would add a second component that writes to the thread. Instead SC-002 is now
measured from the start of the run, and SC-016 requires the trigger-to-start delay to be printed in every
acknowledgement, so queue latency becomes a visible number instead of a hidden breach. The corollary is
that the one-job layout and the single-owner idempotency marker stay as they are.

No open decision remains in this artifact set.

### Revision 4 — implementation language (maintainer request)

The plan originally specified JavaScript with JSDoc annotations checked by `tsc --noEmit`, keeping a
no-build property. The maintainer asked for TypeScript instead, so the project is now strict TypeScript
compiled by `tsc` into `dist/`, with tests written in TypeScript and executed from the build output.

Where it landed: `plan.md` Technical Context (language, dependencies, testing, constraints), the source
tree (`*.ts`, `package.json`, `tsconfig.json`, `dist/` ignored), decision 14, `research.md` D15 (with the
four rejected alternatives), and `quickstart.md` (install, build, test).

Consequences worth remembering: the job now has a build step that can fail (`npm ci`, `npm run build`,
both cached; a build failure is `environment`, not an agent failure); the type checker runs on the tests
too, so tests cannot pass against code that no longer compiles; and `dist/` must stay out of commits,
diffs, and proposals. The "no build step" advantage recorded for D9 in §4 is superseded by this
revision.

### Revision 5 — remaining analysis findings (maintainer approved)

The `/speckit.analyze` pass left twelve findings below the top-five threshold. All were applied:

| Finding | Resolution |
|---|---|
| G6 ambiguity had no path | New task **T040** plus `agent-question:` block → `agent:notice kind=question` → `waiting` (FR-006) |
| G7 `maxTurns` / `maxWallClockMinutes` unenforced | Task T030 now stops on both and posts `agent:limit`; T032 asserts it |
| G8 `agent:limit` had no posting task | Folded into T030 |
| U1 sweep window undefined | New config key `sweep.graceMinutes` in `contracts/config.md`; T003 creates it, T058 uses it |
| U2 second notice use undefined | `contracts/thread-messages.md` §9 now defines three report blocks and three notice kinds (`directive`, `question`, `unmet`); T026 parses them, T066 renders `unmet` |
| U3 egress allowlist could block provider auth | `network.allowHosts` must cover authentication **and** inference; `pi-rpc.md` network table updated |
| C1 stale constitution version in plan | `plan.md` now cites 2.0.1 |
| D1 FR-011 duplicated FR-033 | Duplicate clause removed from FR-011; FR-011 points to FR-033 |
| D2 T082/T089 overlapped | T082 owns orchestrator strings, T089 owns identifiers/comments/test names |
| D3 T078/T083 overlapped | T083 refers to T080 for the egress half |
| D4 T016 asserted redaction | T016 now checks that templates carry no literal credential; redaction stays in T017/T018 |
| A1 "plain language" unmeasurable | FR-005 defines it as state, cause and next action; FR-012 and US3.3 reference that definition |
| I1 label named four ways | New **Request Label** entity; FR-003/FR-026 use that term, contracts keep `agent:run` |
| I2 "queue delay" vs "trigger-to-start delay" | `queue delay` everywhere; SC-016 defines it |
| I3 traceability gaps | Rows added for SC-005/006/007/010/011/012/013 |

Task count after this round: **90**. The task IDs were renumbered once more and every reference in
Dependencies, the parallel examples, the strategy notes and the traceability table was remapped and
verified.
