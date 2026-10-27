---

description: "Task list for the issue-driven agentic workflow"
---

# Tasks: Issue-Driven Agentic Workflow

**Input**: Design documents from `/specs/001-issue-driven-agent-workflow/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

> **Note (2026-10-27)**: [`plan.md`](./plan.md) §"Amendment 2026-10-27" adds Pi runtime provisioning
> and the privilege handoff. The baseline tasks in this file are complete; the amendment's executable
> tasks are in [§Amendment 2026-10-27](#amendment-2026-10-27-pi-runtime-provisioning-open) at the end of
> this file (T091–T120); they are implemented except T115/T116, which need a hosted runner. The
> fingerprint input list below is extended by that amendment with the pinned Pi version.

**Tests**: Included. `plan.md` §Testing and `quickstart.md` require a specific test tree, and SC-014,
SC-015 and the injection-resistance contract are only verifiable through those tests.

**Organization**: Tasks are grouped by user story so each story is independently implementable and
verifiable. Every task names the exact file it touches.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 … US5, matching `spec.md`
- File paths are repository-relative

## Path Conventions

Single project: `src/agent/` (TypeScript), `tests/`, `.agent/` (reviewable configuration),
`.github/` (workflows and the egress script). Build output goes to `dist/` and is never committed.

## Constraints that apply to every task

- TypeScript `strict`, no implicit `any`, no `@ts-ignore` without a stated reason (`plan.md` §Constraints).
- All identifiers, comments, log lines, message templates, commit and branch text in English
  (constitution I, FR-019). Issue threads may be in any language; artifacts never are.
- No task may add a runtime dependency beyond `@earendil-works/pi-coding-agent` (`plan.md`).
- No task may add a merge, approve, or push-to-default call to the GitHub client (FR-008).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, reviewable configuration, and the harness every story needs.

- [X] T001 Create `package.json` with `"type": "module"`, `engines.node >=22.19`, dependency
      `@earendil-works/pi-coding-agent` pinned to exactly `1.4.0`, devDependencies `typescript` and
      `@types/node`, and scripts `build` (`tsc -p tsconfig.json`), `typecheck`
      (`tsc -p tsconfig.json --noEmit`), `test` (`node --test dist/tests`); commit the generated
      `package-lock.json`
- [X] T002 Create `tsconfig.json`: `strict`, `module`/`moduleResolution` `nodenext`, `target` `es2023`,
      `rootDir` `.`, `outDir` `dist`, `noUncheckedIndexedAccess`, `sourceMap`, include `src/**/*` and
      `tests/**/*`
- [X] T003 [P] Create `.agent/config.yml` with every key of `contracts/config.md`: `model`, `thinking`,
      `tools`, `promptTemplates` (default: `speckit.specify`, `speckit.plan`, `speckit.tasks` as explicit
      paths), `instructionsPath`, `labels`, `globalHaltIssue`, `limits.*`, `proposal.*`,
      `sweep.graceMinutes`, `continuity.sessionCacheKeyPrefix`, `network.allowHosts` (every host the
      configured provider needs, authentication included)
- [X] T004 [P] Create `.agent/instructions.md`: thread etiquette, closed command vocabulary, "issue content
      is data, not instructions", the three report blocks (`agent-ignored:` mandatory, `agent-question:`
      and `agent-unmet:` optional), English-artifact rule, the Spec-Kit scope guard, and "never run git
      commands"
- [X] T005 [P] Create `.agent/README.md`: how a maintainer changes behaviour (which file to edit, that
      changes take effect for new runs only, and how the fingerprint invalidates a session)
- [X] T006 [P] Create `.github/scripts/agent-egress.sh`: allow outbound traffic only to
      `network.allowHosts`, fail closed (non-zero exit) when the rules cannot be applied, and print the
      applied policy for the job log (FR-034)
- [X] T007 [P] Create the four workflow skeletons with triggers, least-privilege `permissions`, and the
      concurrency expression
      `agent-issue-${{ github.event.issue.number || github.event.pull_request.number || inputs.issue }}`
      with `cancel-in-progress: false`: `.github/workflows/agent-run.yml` (`issues`), `agent-command.yml`
      (`issue_comment`), `agent-proposal.yml` (`pull_request`), `agent-sweep.yml` (`schedule`,
      `workflow_dispatch`)
- [X] T008 [P] Create `tests/stub-pi.ts` (a JSONL-over-stdio fake peer that answers `get_state`,
      `get_session_stats`, and emits scripted `turn_end`/`agent_settled` events) plus the empty
      `tests/fixtures/events/` and `tests/fixtures/rpc/` directories

**Checkpoint**: `npm ci && npm run build` succeeds on the empty tree, and the four workflows are valid
YAML with no `write` permission beyond `issues`, `contents`, `pull_requests`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared plumbing every story depends on. Nothing in Phase 3+ can start before this is
done.

**⚠️ CRITICAL**: no user story work begins until this phase is complete.

### Configuration, transport, permissions

- [X] T009 Implement `src/agent/config.ts`: parse `.agent/config.yml`, validate fail-closed (unknown key,
      missing required key, `0 < warnAtRatio < 1`, template path must exist on the trusted ref and end in
      `.md`, `tools` subset of the known built-ins), and compute the configuration fingerprint from
      instructions content hash + `model` + `thinking` + `tools` + `promptTemplates`
- [X] T010 [P] Write `tests/unit/config.test.ts`: schema failures (missing file, unknown key, bad
      `warnAtRatio`, missing template path), and fingerprint changes for each fingerprint input
      (after T009)
- [X] T011 Implement `src/agent/github.ts`: thin `fetch` client over the endpoints the feature uses
      (issue, comments, labels, timeline, review states, pull request create, pull request read, repo
      collaborator permission), with pagination, `403` rate-limit backoff for bookkeeping calls, and typed
      errors; the module must expose **no** merge/approve/force-push method (FR-008)
- [X] T012 Implement `src/agent/events.ts`: map an event payload to a `Trigger` with
      `origin` ∈ {`label`,`retry-command`,`continue-command`}, `event`, `actor`, `at`, `commandId`, plus a
      request snapshot (`requestText`, `requestVersion` = `updated_at` + body hash); `issues.opened` may
      never produce a run without the request label (FR-026)
- [X] T013 Implement `src/agent/permissions.ts`: decide "write access and above" through the collaborator
      permission endpoint, with a re-check function used at every decision point (FR-024, FR-025)
- [X] T014 [P] Write `tests/unit/permissions.test.ts`: allowed/denied roles, and a demotion between
      trigger and decision being refused (after T013)

### Record: messages, markers, state log, labels

- [X] T015 Implement `src/agent/messages.ts`: the ten templates of `contracts/thread-messages.md`
      (`agent:ack`, `agent:status`, `agent:feedback`, `agent:result`, `agent:error`, `agent:decision`,
      `agent:limit`, `agent:session`, `agent:notice`, `agent:outcome`) as fixed English strings with
      data interpolation only, plus the `agent-ignored:` block parser for `agent:notice`
- [X] T016 [P] Write `tests/unit/messages.test.ts`: every template contains its marker and no
      non-English literal, and no template body contains a literal credential (redaction itself is
      asserted in the `redact` test) (after T015)
- [X] T017 Implement `src/agent/redact.ts`: known credential shapes and known job secret values replaced by
      `[redacted]`, with a flag the caller records when a redaction happened (FR-018, SC-010)
- [X] T018 [P] Write `tests/unit/redact.test.ts`: token-shaped strings, `.env` values, and a non-secret
      control string (after T017)
- [X] T019 Implement `src/agent/thread.ts`: read the issue and its comments, locate messages by marker,
      post idempotently (`marker + runId + kind`), append new messages, and rewrite only the
      `agent:status` body from its own rows (never touching earlier rows)
- [X] T020 Implement `src/agent/state-log.ts`: append a row (`at`, `state`, `runId`, `consumed`,
      `next act`), keep rows chronological and immutable, assert newest row equals the `State:` line, and
      reconcile the label to the newest row (invariant I2, authoritative direction: log → label)
- [X] T021 [P] Write `tests/unit/state-log.test.ts`: append-only behaviour, idempotent re-render, row/label
      reconciliation, and a duplicate event producing no second row (after T020)
- [X] T022 Implement `src/agent/labels.ts`: the transition table of `contracts/labels.md` including the
      `unexpected-retry` failure edge, one-state invariant, terminal stickiness, request-label
      remove-then-add lifecycle, and duplicate `labeled` handling
- [X] T023 [P] Write `tests/unit/labels.test.ts`: I1 (one state label), I3 (terminal stickiness), duplicate
      trigger collapses, request-label re-trigger procedure (after T022)

### Commands, harness session, budget

- [X] T024 Implement `src/agent/commands.ts`: grammar of `contracts/commands.md` — `/agent` must be the
      first non-whitespace token, case-insensitive word, code fences and mid-sentence mentions are not
      commands, first command wins, decision words `{halt, retry, continue, approve, reject}` versus
      informational `{status, help}`, unknown word → help text
- [X] T025 [P] Write `tests/unit/commands.test.ts`: mid-sentence, fenced, multiple commands, unknown word,
      and the five decision words mapping to their kinds (after T024)
- [X] T026 Implement `src/agent/directive-report.ts`: extract the three agent report blocks —
      `agent-ignored:` (`none` or a list), `agent-question:` (one question), `agent-unmet:` (`none` or a
      list) — reject unparsable content, and produce the `agent:notice` payload with its `kind`
      (`directive`, `question`, `unmet`); a missing `agent-ignored:` block yields the explicit "no
      directive report was produced" notice and a state-log note (FR-006, FR-014, FR-030)
- [X] T027 [P] Write `tests/unit/directive-report.test.ts`: `none`, list, missing, unparsable, and a
      directive text that would look like an instruction (after T026)
- [X] T028 Implement `src/agent/pi-session.ts`: launch Pi with exactly the flags of
      `contracts/pi-rpc.md` (including `--offline`, `--no-approve`, the five `--no-*` discovery flags, the
      allowlisted `--prompt-template` arguments, `--model`/`--thinking` from config, fingerprinted
      `--session-id`), strip `GITHUB_TOKEN`/`GH_TOKEN` from the child environment, send
      `set_auto_retry false` and `set_auto_compaction false` before the first prompt, assert the effective
      tool list and model through `get_state`, and drive the `turn_end` boundary loop
- [X] T029 Implement `src/agent/session-accounting.ts`: record one `agent:session` per Pi session
      (`sessionId`, fingerprint, run ids, consumed, `endedBecause`), and compute the per-issue total as the
      sum of documented sessions
- [X] T030 Implement `src/agent/budget.ts`: warn at `limits.warnAtRatio` (posts the warning), hard-stop at
      the sum-based cost cap (posts `agent:limit` with the consumed amount and the required action),
      hard-stop at `limits.maxTurns` and `limits.maxWallClockMinutes` with the same `agent:limit` message,
      and raise the allowance by `limits.continueIncrementUsd` only from a recorded `continue` decision
      (FR-017, `contracts/config.md`)
- [X] T031 [P] Write `tests/unit/session-accounting.test.ts`: two sessions add up, a lost cache does not
      reset the total, and `endedBecause: lost` is recorded (after T029)
- [X] T032 [P] Write `tests/unit/budget.test.ts`: soft warning at the configured ratio, hard stop at the
      cost cap, hard stop at `maxTurns` and at `maxWallClockMinutes` each posting `agent:limit`, and the
      increment applied once per recorded `continue` (after T030)

**Checkpoint**: configuration, transport, permissions, record primitives, command grammar, the Pi
lifecycle, and accounting are implemented and unit-tested. Any story can now be built.

---

## Phase 3: User Story 1 — Request work from an issue and read the result in the thread (Priority: P1) 🎯 MVP

**Goal**: label an issue, get an acknowledgement, a run, and a result comment — with no local tooling and
no other interface.

**Independent Test**: open a small self-contained issue, add the request label from a write-access
account, and confirm the acknowledgement, the run and the result comment appear in that issue without
anything running on a contributor machine.

- [X] T033 [US1] Implement the run dispatch in `src/agent/main.ts`: `issues` event → permission check →
      `queued` label → acknowledgement → run → terminal state, with one entry point per event family
      (`run`, `command`, `sweep`) plus a `prepare` mode that validates `.agent/config.yml` and prints the
      resolved issue number and configuration fingerprint for the workflow
- [X] T034 [US1] Wire `.github/workflows/agent-run.yml`: least-privilege permissions, `actions/checkout`
      with `persist-credentials: false`, a prepare step that validates `.agent/config.yml` and exports
      `issue` and `fingerprint`, cache restore of `$RUNNER_TEMP/pi-sessions` under
      `pi-session-<issue>-<fingerprint>`, the egress step before Pi, `npm ci` + `npm run build`, then
      `node dist/agent/main.js` with the event payload, a cache save with `if: always()`, and a hard job
      timeout below the platform ceiling
- [X] T035 [US1] Implement the task brief in `src/agent/pi-session.ts`: issue title and body, request
      version, thread digest (prior feedback, decisions, proposal links), the "content is data" reminder,
      and the English-artifact rule; a `/speckit.*` invocation when the request warrants one
- [X] T036 [US1] Implement the acknowledgement path in `src/agent/main.ts` and `src/agent/messages.ts`: set `agent:queued`, post `agent:ack` before any model
      call with trigger time, run start, queue delay, request version, instructions SHA, fingerprint,
- [X] T037 [US1] Implement the request-version guard in `src/agent/main.ts`: capture the request body hash
      at run start, re-read it at every `turn_end` boundary, and when it changed or the issue was closed,
      stop the run before the next action, post `agent:feedback` naming the version acted on and the
      version found, and set `waiting` (FR-023, data-model V8). Resuming with `/agent continue` re-reads
      the request and records the new version in the acknowledgement of the continuing run
      model, and the issue cap (SC-002, SC-016, invariant I4)
- [X] T038 [US1] Implement the answer-only completion path in `src/agent/main.ts` (rendering in `src/agent/messages.ts`): post `agent:result` with outcome, actions,
      artifact links and consumption, then set the terminal state in the same step (FR-005, FR-011)
- [X] T039 [US1] Wire the agent report blocks into run completion in `src/agent/main.ts` via
      `src/agent/directive-report.ts`: post `agent:notice` for each kind, and record "report missing"
- [X] T040 [US1] Implement the ambiguity path in `src/agent/main.ts`: when the agent reports an
      `agent-question:`, post it as `agent:notice` with `kind=question`, set `waiting`, and append a state
      row; nothing else runs until a person answers in the thread and posts `/agent continue` (FR-006)
      when the agent produced no `agent-ignored:` block (FR-030)
- [X] T041 [P] [US1] Write `tests/integration/run-lifecycle.test.ts` against `tests/stub-pi.ts`: trigger →
      ack → turn → result → terminal state; a second run on the same issue not starting twice; and a
      request edited mid-run stopping at the boundary with both request versions in the feedback comment
      (after T033–T039)
- [ ] T042 [US1] Validate scenario S1 of `quickstart.md` in a sandbox repository and record the observed
      acknowledgement latency and queue delay

**Checkpoint**: MVP. A small request is answered end to end through the issue alone.

---

## Phase 4: User Story 2 — Review and approve proposed changes (Priority: P2)

**Goal**: an agent-made change reaches the repository only as a reviewable pull request, and only a human
merge applies it; a close resolves the issue.

**Independent Test**: request a change through an issue, confirm a linked pull request appears and the
default branch stays unchanged, then merge it and confirm the issue reaches `finished`; repeat with a
closed-unmerged pull request and confirm `rejected`.

- [X] T043 [US2] Implement `src/agent/workspace.ts` branch handling: name `agent/<issue>-<slug>` with
      lower-case ASCII `[a-z0-9-]`, at most six words, `issue-<number>` fallback for non-Latin titles,
      `-2`/`-3` suffix instead of force-push, created from the default branch head and recorded in the
      acknowledgement
- [X] T044 [US2] Implement diff collection and commit in `src/agent/workspace.ts`: exclude `dist/`,
      session files and `.git`, apply the `proposal.maxChangedPaths` / `proposal.maxDiffLines` bounds
      (`request-too-large`), redact before commit, abort with `secret-request` and commit nothing when a
      credential is detected, and use the fixed English message `agent: <summary> (#<issue>)` (≤72 chars,
- [X] T045 [US2] Implement the push in `src/agent/workspace.ts`: push `agent/<issue>-<slug>` with a
      per-job credential supplied for that one command only (`git -c http.extraheader="AUTHORIZATION:
      basic <base64>"` or a `GIT_ASKPASS` helper), never written to `.git/config`; remove it immediately
      afterwards and assert that the workspace git config contains no token. A push without a usable
      credential fails the run with `environment`, and a rejected push (protected branch,
      non-fast-forward) fails with `content-conflict` (FR-021, research D10 layer c)
      fallback `address issue <number>`)
- [X] T046 [US2] Implement `src/agent/proposal.ts`: open the pull request (base default branch, head
      `agent/…`, `agent:proposal` label, no reviewers, not a draft) with the English body containing the
      issue link, what changed, what was not done, how it was verified, and the request version; link it in
      the thread and set `waiting` with `next act = review the proposal`
- [X] T047 [US2] Ensure the proposal path cannot apply changes: no merge/approve endpoint in
      `src/agent/github.ts`, `/agent approve` only annotates, and a default-branch push is impossible with
      the credential the orchestrator uses (FR-007, FR-008)
- [X] T048 [P] [US2] Write `tests/unit/proposal.test.ts`: branch naming including the non-Latin fallback
      and suffix behaviour, bounded diff rejection, redaction abort, a client with no merge capability, and
      a push helper that carries its credential as an argument or askpass value, never as a config entry
      (after T043–T047)
- [X] T049 [US2] Wire `.github/workflows/agent-proposal.yml` for `pull_request` `closed` and `review`
      events with the same permission gate and a resolved issue number from the branch name or body link
- [X] T050 [US2] Implement review decisions in `src/agent/proposal.ts`: `approved` → `approve`,
      `changes_requested` → `reject`, mirrored into the thread as `agent:decision` with source `review` and
      actor/timestamp, ignoring reviews from accounts without write access
- [X] T051 [US2] Implement close handling in `src/agent/proposal.ts` and `src/agent/labels.ts`: on `pull_request.closed` record `agent:outcome` and a decision
      with source `close`, set `finished` when merged and `rejected` when not, and append the state row in
      the same operation (FR-033)
- [X] T052 [P] [US2] Write `tests/integration/proposal-outcome.test.ts`: review decision recorded, merged
      close → `finished`, unmerged close → `rejected`, the default branch untouched before the merge, and
      after the run the branch existing on the remote while `.git/config` contains no credential
      (after T049–T051)
- [ ] T053 [US2] Validate scenario S2 of `quickstart.md`, including the egress check of S13

**Checkpoint**: changes are safe to enable; nothing reaches the default branch without a human merge.

---

## Phase 5: User Story 3 — Follow progress of long-running work (Priority: P3)

**Goal**: an issue always shows a truthful state, a plain-language result, and never stays `working`.

**Independent Test**: start work, watch the state rows develop and end in an end state; kill a job
mid-run and confirm the issue is reconciled to `failed` with reason `interrupted`.

- [X] T054 [US3] Implement the status refresh in `src/agent/main.ts`: on every `turn_end` boundary append a
      state row and update `Consumed`, `Proposal` and `Next act needed`, so no follow-up question is needed
      (SC-007)
- [X] T055 [US3] Implement failure classification in `src/agent/messages.ts` and `src/agent/main.ts`: the
      enum of `contracts/thread-messages.md` incl. `unexpected-retry`, a requester-actionable vs
      environmental split, and the "can you fix it?" line (FR-012)
- [X] T056 [P] [US3] Write `tests/integration/retry-signal.test.ts`: a `summarization_retry_scheduled`
      or `willRetry` event aborts the run, fails it with `unexpected-retry`, and the thread names the
      signal (after T055)
- [X] T057 [US3] Guarantee end states in `src/agent/main.ts` and `src/agent/state-log.ts`: write the terminal label in the same step as the terminal comment,
      and treat a missing `endedAt` as a defect that fails the run rather than leaving `working`
      (FR-011, invariant I3)
- [X] T058 [P] [US3] Write `tests/integration/budget-stop.test.ts`: the limit stops the run at a
      boundary, posts `agent:limit`, sets `waiting`, and nothing continues without `/agent continue`
      (after T030)
- [X] T059 [US3] Implement `src/agent/reconcile.ts`: resolve `working` issues older than
      `sweep.graceMinutes` to `failed`/`interrupted`, repair half-applied state-label changes, and ignore
      issues an active job owns (invariant I5, `contracts/config.md`)
- [X] T060 [US3] Wire `.github/workflows/agent-sweep.yml`: `schedule` plus `workflow_dispatch`, dry-run
      mode, and a summary line of what it repaired
- [X] T061 [P] [US3] Write `tests/unit/reconcile.test.ts`: interrupted run resolves, half-applied labels
      repaired, active run untouched (after T059)
- [ ] T062 [US3] Validate scenario S3 of `quickstart.md`, including killing a job in the Actions UI and
      confirming `agent-sweep.yml` reconciles it

**Checkpoint**: progress is legible at any time, from the issue alone.

---

## Phase 6: User Story 4 — Control the agent's behaviour from repository content (Priority: P3)

**Goal**: a maintainer changes the agent's behaviour by editing a committed file, and the change applies to
new work only.

**Independent Test**: edit a house rule in `.agent/instructions.md`, merge it, trigger a run, and confirm
the new run records the new instructions version while the earlier run keeps its old one.

- [X] T063 [US4] Load `.agent/instructions.md` from the trusted-ref checkout and pass it via
      `--append-system-prompt`; record its path, commit SHA and short hash in `agent:ack` (FR-014)
- [X] T064 [US4] Enforce the prompt-template allowlist in `src/agent/config.ts` and `src/agent/pi-session.ts`, and assert at startup that every
      configured command exists; a missing or non-allowlisted template fails the run with `environment`
      before any model call (research D13)
- [X] T065 [P] [US4] Write `tests/unit/templates.test.ts`: allowlisted templates only, missing path fails
      validation, an out-of-repository path fails, a non-allowlisted slash command stays plain text
      (after T064)
- [X] T066 [US4] Enforce "new work only" for configuration in `src/agent/pi-session.ts` and
      `src/agent/config.ts`: fingerprint-scoped session id and cache key, a cold start with the thread
      digest on mismatch, no reuse of a session under changed rules, and a "cold start" note in the
      acknowledgement when the cache was missing; `agent:session` reports `endedBecause: lost` only when a
      session existed before and then disappeared (FR-014, research D5)
- [X] T067 [US4] Report an instruction the agent cannot honour through `src/agent/messages.ts`: render the
      `agent-unmet:` entries as an `agent:notice` with `kind=unmet`, naming the instruction and the
      reason, instead of a silent deviation (FR-014 acceptance 3)
- [ ] T068 [US4] Validate scenario S4 of `quickstart.md` (new commit SHA in the new run, old SHA in the
      earlier record)
- [ ] T069 [US4] Validate scenario S12 of `quickstart.md`, including the negative variant where a
      non-allowlisted `/speckit.analyze` must be reported as an ignored directive

**Checkpoint**: behaviour is governed by reviewable repository content, and the record shows which version
acted.

---

## Phase 7: User Story 5 — Pause or stop the agent from the issue thread (Priority: P3)

**Goal**: a permitted person can halt an issue or the whole repository and get a truthful feedback comment
before anything is reported as halted.

**Independent Test**: post a halt while a run is active, confirm the current action finishes, a feedback
comment lists what was completed and left undone, then the issue becomes `halted`; post a halt from an
account without write access and confirm it is ignored with an explanation.

- [X] T070 [US5] Wire `.github/workflows/agent-command.yml`: `issue_comment` → command parse →
      permission re-check → dispatch into `src/agent/main.ts` without starting a model call for
      informational commands
- [X] T071 [US5] Implement command dispatch in `src/agent/main.ts`: route decision words to their effects,
      record `agent:decision` with source `command`, actor, reason (redacted) and the applied boundary, and
      answer unknown words with the help text (FR-026)
- [X] T072 [US5] Implement `src/agent/halt-watch.ts`: poll the thread for commands while a run is active,
      queue them in arrival order, and expose them to the boundary loop only
- [X] T073 [US5] Implement the halt sequence for `src/agent/main.ts` + `src/agent/pi-session.ts`: at the
      next `turn_end` call `get_state`, post `agent:feedback` (completed / not done / state to resume from,
      consumed), then `abort`, then wait for `agent_settled`, then `halted` (FR-027, FR-028, SC-009)
- [X] T074 [US5] Implement the repository-wide halt in `src/agent/commands.ts` and `src/agent/main.ts` via `config.globalHaltIssue`: block new work until
      lifted, state the scope in the reply, and reflect the blocking state in that issue (FR-015)
- [X] T075 [US5] Implement `retry` with lineage in `src/agent/main.ts` and `src/agent/messages.ts`: new run, `continuesRunId` recorded in `agent:ack` and the
      state row, thread shows the attempt sequence (FR-031, FR-032)
- [X] T076 [US5] Implement `continue` in `src/agent/budget.ts` and `src/agent/main.ts`: resume from `waiting`, raise the allowance by
      `limits.continueIncrementUsd` only for a consumption stop, and record the new allowance
- [X] T077 [US5] Implement the decision-time permission re-check in `src/agent/permissions.ts` so a person demoted after the trigger can
      no longer halt, retry, continue, approve or reject (FR-025), including the explanation in the thread
- [X] T078 [US5] Implement `status` and `help` in `src/agent/commands.ts` as informational replies that never change state and never
      create a decision record
- [X] T079 [P] [US5] Write `tests/integration/halt-boundary.test.ts`: halt during a turn produces `abort`
      only after `turn_end`, is preceded by the feedback comment, and no steering/follow-up is queued at
      abort time (after T071–T074)
- [ ] T080 [US5] Validate scenarios S5 and S6 of `quickstart.md` (halt, queued retry, demoted account)

**Checkpoint**: there is a working emergency brake reachable through the only interface.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: hardening and end-to-end verification across all stories.

- [ ] T081 [P] Verify the egress restriction end to end: `.github/scripts/agent-egress.sh` runs before Pi,
      a request outside `network.allowHosts` fails, and a run whose restriction cannot be applied fails
      with `environment` without a model call (FR-034)
- [X] T082 [P] Add the output scan: every thread body and every committed file passes `redact.ts`, and a
      post-commit scan aborts the proposal if a credential still matches (FR-018, SC-010)
- [ ] T083 [P] Audit all orchestrator-owned strings — message templates, commit messages, branch slugs,
      log lines — for English-only output, and run scenario S11 of `quickstart.md` with a non-English
      thread (constitution I, FR-019)
- [ ] T084 [P] Verify SC-016 reporting in `src/agent/messages.ts`: the acknowledgement prints trigger time, run start and queue delay,
      and the delay is present for every run in a 20-run sample
- [ ] T085 [P] Verify the no-retry guarantee in a real run via `src/agent/pi-session.ts` and `tests/integration/retry-signal.test.ts`: `auto_retry_start`, `summarization_retry_*`,
      `compaction_*` and `willRetry` never pass silently, and a forced long conversation ends as
      `unexpected-retry` (FR-031)
- [ ] T086 [P] Verify the injection boundary in `src/agent/pi-session.ts`: `GITHUB_TOKEN` absent from Pi's
      environment, `.git/config` free of credentials, and a recorded S7 set of 10 hostile issues performed
      only the real request (SC-014); the egress half is verified by T081
- [X] T087 [P] Pin and audit dependencies in `package.json`: `@earendil-works/pi-coding-agent` exactly `1.4.0`, `npm audit`
      reviewed, and no new runtime dependency added (plan §Primary Dependencies)
- [ ] T088 Run the full `quickstart.md` sequence S1–S14 once against a sandbox repository, including
      every negative variant and the human-only check S10 (third-party reconstruction from the issue
      alone), and record each expected outcome
- [X] T089 Compare the implementation against `plan.md` §"Design Decisions" and update the plan where the
      implementation legitimately diverged (no silent drift)
- [X] T090 Review `src/agent/**` and `tests/**` for English identifiers, comments and test names (the
      orchestrator-owned strings are covered by T083), and record in the review that the language standard
      was checked (constitution I)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001–T008, no dependencies; T001/T002 must precede every other task that compiles.
- **Foundational (Phase 2)**: T009–T032, depends on T001/T002; **blocks all stories**.
- **User stories (Phases 3–7)**: each depends on Phase 2 only. US2 additionally reuses the run lifecycle
  from US1 in practice, but its own deliverable (proposal + outcome) is testable against the stub.
- **Polish (Phase 8)**: depends on the stories that exist; T088 needs all of them.

### Story Dependencies

- **US1 (P1)**: no dependency beyond Phase 2 — the MVP.
- **US2 (P2)**: Phase 2 + the run dispatch from T033; deliverable testable via S2.
- **US3 (P3)**: Phase 2 + T033 (run) for status rows; reconciler is independent of US2.
- **US4 (P3)**: Phase 2 + T033; changes no story-2 behaviour.
- **US5 (P3)**: Phase 2 + T033; halt requires a running session but not a proposal.

### Within a Story

Tests are written after their module (they compile with the same `tsconfig`) and must fail before the
module is called done. Models/primitives before services, services before workflow wiring, workflow
wiring before the quickstart scenario.

### Parallel Opportunities

- T003–T008 (configuration, instructions, README, egress script, workflow skeletons, stub peer).
- T010, T014, T016, T018 (unit tests once their modules exist).
- T021, T023, T025, T027 (record and command primitives).
- T031, T032 (accounting and budget tests).
- After Phase 2: US1 can start while US3's reconciler (T059–T061) and US4's template enforcement
  (T064–T065) proceed in parallel, since they touch different files.
- In Polish: T081–T087 are largely independent verifications; T088–T090 close the loop.

---

## Parallel Example: User Story 1

```bash
# After T033–T039 exist, these can run together:
Task: "Write tests/integration/run-lifecycle.test.ts against tests/stub-pi.ts"
Task: "Validate quickstart.md S1 in the sandbox repository"

# Foundational pair that never touch the same file:
Task: "Implement src/agent/session-accounting.ts"
Task: "Implement src/agent/budget.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: T001–T008.
2. Phase 2: T009–T032 — no story work before this checkpoint.
3. Phase 3: T033–T042.
4. **STOP and validate**: run S1 twice (answer-only request, and a request the agent cannot act on).
5. The MVP already satisfies FR-001/002/003/004/005/019/020 and SC-001/002/006/016.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. US1 → the workflow answers requests; the terminal state path exists.
3. US2 → changes become reviewable pull requests and resolve on close; the workflow is safe to enable on a
   shared repository.
4. US3 → progress and recovery make it trustworthy unattended.
5. US4 → behaviour is governed from the repository.
6. US5 → the emergency brake lands before the workflow is advertised to contributors.

### Suggested ordering inside US2/US5

US2's T047 (no-merge guarantee) and US5's T073 (halt before anything reports `halted`) are the two tasks
that must not be deferred: they are the safety properties the feature exists for. If the schedule slips,
implement T047 and T073 before the remaining polish tasks.

---

## Traceability

| Requirement group | Tasks |
|---|---|
| FR-001/002/003/004/005/020 (issue-only interface, run, result) | T007, T012, T033–T042 |
| FR-006/023 (do not redefine, stop on modified request) | T012, T035, T037, T040 |
| FR-007/008/009/033 (proposal, no self-merge, records, close) | T011, T043–T053 |
| FR-010/011/012 (visible state, end states, failure reasons) | T020, T022, T054–T062 |
| FR-013 (no concurrent runs) | T007, T019, T022 |
| FR-014 (standing instructions, current version only) | T003, T004, T009, T063–T069 |
| FR-015/026/027/028 (halt, command words, boundaries, feedback) | T024, T070–T080 |
| FR-016/019 (record, English) | T015, T019, T020, T083 |
| FR-017 (consumption limit) | T029, T030, T031, T032, T076 |
| FR-018/034 (secrets, egress) | T006, T017, T044, T081, T082 |
| FR-023 (stop on modified or withdrawn request) | T037, T020, T036 |
| FR-021/024/025 (credentials, permissions) | T011, T013, T077, T086 |
| FR-022 (existing issue trigger) | T012, T022, T034 |
| FR-029/030 (content is data, directive report) | T004, T015, T026, T039, T086 |
| FR-031/032 (no retry, lineage) | T028, T055, T075, T085 |
| SC-002/SC-016 (ack latency, queue delay) | T036, T084 |
| SC-003/SC-009/SC-014/SC-015 | T057, T073, T086, T012 |
| SC-005 (reconstruction from the issue alone) | T019, T020, T088 |
| SC-006 (no local tooling) | T034 |
| SC-007 (no status follow-up questions) | T054 |
| SC-010 (no secrets in published output) | T017, T082 |
| SC-011 (no disruption without a decision) | T047, T052 |
| SC-012 (limit respected) | T030, T058 |
| SC-013 (resume without repeating a step) | T035, T066, T073 |

---

## Notes

- [P] means a different file and no dependency on an incomplete task; it is not a priority signal.
- Every workflow change must keep `permissions` at the documented minimum; a new permission is a spec
  change, not an implementation detail.
- Commit after each task or logical group; keep `dist/` out of every commit.
- The three verifications that must pass before this leaves a sandbox repository: S7 (injection),
  S13 (no push, no egress), S6 (permission gate).

---

## Implementation Status (recorded 2026-10-27)

Marked `[X]` above: every baseline task whose deliverable is code, configuration, workflow definition, or
an automated test in this repository. The suite runs with `npm ci && npm run build && npm test`
(159 tests after the amendment: 134 unit, 25 integration). The amendment tasks T091–T120 below are implemented except T115/T116,
which need a hosted runner.

Left `[ ]` on purpose — these require a live sandbox repository and cannot be executed from the
development checkout:

| Task | Why it is open |
|------|----------------|
| T042, T053, T062, T068, T069, T080 | Scenario validation in a sandbox repository (S1–S6, S12) |
| T081 | End-to-end egress enforcement on a GitHub-hosted runner (needs root and iptables) |
| T083 (S11), T084 (20-run sample), T085 (forced long conversation), T086 (10 hostile issues) | Observations that only a running workflow can produce |
| T088 | Full S1–S14 pass against the sandbox |
| T115 | S15 on a hosted runner (uid, iptables, traversal) |
| T116 | S1/S2/S5/S13/S14 regression on a hosted runner |

The three gate checks named in the Notes (S7 injection, S13 no-push/no-egress, S6 permission gate) keep
their automated coverage: the stub log asserts no repository credential reaches the agent process, the
client surface has no merge/approve/force-push method, and permission denial is exercised at trigger and
at decision time.

---

# Amendment 2026-10-27: Pi Runtime Provisioning (open)

**Input**: [`plan.md`](./plan.md) §"Amendment 2026-10-27", [`research.md`](./research.md) D16/D17,
[`data-model.md`](./data-model.md) §10, [`contracts/pi-rpc.md`](./contracts/pi-rpc.md) §"Runtime
preconditions" and §"Privilege handoff and workspace ownership", [`quickstart.md`](./quickstart.md) S15.

**Scope**: Close the two blockers recorded in the plan: Pi is not provisioned in the Actions job, and
the Pi-spawning job steps cannot drop privileges because they run unprivileged. This is a cross-cutting
enabler, not a new user story; it blocks every story until complete.

**Tests**: Included. The plan's acceptance table and `contracts/pi-rpc.md` require unit tests for
resolution/validation and integration tests for the spawn shape, workspace boundary, and teardown.

**Execution order**: T091–T120 below. The baseline tasks T001–T090 stay as they are; no task ID is
reused.

## Phase 9: Amendment Setup — Pi runtime resolution (blocking)

**Purpose**: Make the pinned Pi package discoverable and its version verifiable without `PATH`, a
global install, or a hardcoded `"1.4.0"`.

- [X] T091 Create `src/agent/pi-runtime.ts` with `PiRuntimeError` and `readPinnedPiVersion(repoRoot)`:
      read `<repoRoot>/package.json` and `<repoRoot>/package-lock.json`; require
      `dependencies["@earendil-works/pi-coding-agent"]` to match the exact form
      `^\d+\.\d+\.\d+$`; require `packages["node_modules/@earendil-works/pi-coding-agent"].version`
      to equal it; throw `PiRuntimeError` with reason `environment` naming the file and key when the
      pin is missing, ranged, or inconsistent. Export a pure `assertPiRuntime` helper that takes
      `{repoRoot, packageRoot, entry, installedVersion, pinnedVersion, lockedVersion}` so validation is
      testable without touching the real `node_modules`.
- [X] T092 Add `resolvePiRuntime(repoRoot)` to `src/agent/pi-runtime.ts`: use
      `import.meta.resolve("@earendil-works/pi-coding-agent")`, walk up from the resolved module to the
      nearest `package.json`, read `bin.pi`, and return
      `{nodePath: process.execPath, entry, version}`. Reject an entry outside
      `<repoRoot>/node_modules/`, a missing/non-file entry, an installed version that differs from the
      pin, or a `bin.pi` that is absent.
- [X] T093 [P] Write `tests/unit/pi-runtime.test.ts`: success returns the resolved shape with a bare
      `PATH`; a ranged pin, an installed/locked version mismatch, an entry outside `node_modules`, and a
      missing `bin.pi` each fail with reason `environment` and a message naming the offending key.
- [X] T094 [P] Extend `src/agent/config.ts`: add `piVersion` to `computeFingerprint` and to
      `loadConfig`'s inputs via `loadConfig(repoRoot, options?: { piVersion?: string })`, defaulting to
      `readPinnedPiVersion(repoRoot)` when the caller does not inject one; keep every existing
      fingerprint input unchanged. `src/agent/main.ts` passes the resolved pin explicitly (T097); tests
      may inject a fixed version without touching `node_modules`.
- [X] T095 [P] Extend `tests/unit/config.test.ts`: changing only `piVersion` changes the fingerprint;
      each existing input still changes it; a missing or malformed pin fails with `environment`.

**Checkpoint**: `npm run build` succeeds, `tests/unit/pi-runtime.test.ts` and
`tests/unit/config.test.ts` pass, and `resolvePiRuntime(process.cwd())` returns the pinned 1.4.0 entry
with `PATH=/usr/bin:/bin`.

---

## Phase 10: Amendment Foundational — process, workspace, and job wiring (blocking)

**Purpose**: Make the resolved runtime actually launchable under the egress uid, and make the workspace
safe to hand to the agent before git runs as root.

- [X] T096 Update `src/agent/pi-session.ts`: replace `piCommand`/`argPrefix`/the hardcoded default
      `piVersion` with a required `runtime: PiRuntime`; spawn
      `spawn(runtime.nodePath, [runtime.entry, ...buildLaunchArgs(...)])`; keep `--mode rpc` in
      `buildLaunchArgs`; add an explicit child environment with `HOME`, `TMPDIR`, and `XDG_CACHE_HOME`
      under the session directory; spawn `detached: true`; in `dispose`/teardown kill the process group
      and, when `egressUid` is set, reap every process owned by `AGENT_EGRESS_UID` before returning.
      Inject the kill/reap operations (or a `spawnImpl`) so tests can assert the order without root.
- [X] T097 Update `src/agent/main.ts`: read `AGENT_ENV_FILE` once (mode `0600`), unlink it immediately,
      merge `GITHUB_TOKEN` and `ANTHROPIC_API_KEY` into the orchestrator environment, and keep the
      existing `sanitizeEnvironment` stripping for the Pi child. Resolve the Pi runtime *before* posting
      `agent:ack`; assert uid 0 when `AGENT_EGRESS_UID` is set; pass the runtime to `createSession`; use
      `runtime.version` in the acknowledgement instead of a literal. A resolution or privilege failure
      posts `agent:error` with reason `environment` and does not post an acknowledgement.
- [X] T098 Update `src/agent/workspace.ts` with `prepareAgentWorkspace(repoRoot, egressUid)`: after
      checkout, move `.git` to a root-owned mode-`0700` `GIT_DIR` under `RUNNER_TEMP` and remove any
      `.git` entry from the work tree; chown the work tree recursively to the egress uid **except**
      `node_modules/`; ensure execute permission on the ancestors of `GITHUB_WORKSPACE` for the egress
      uid. Update every git command to use `--git-dir=<GIT_DIR> --work-tree=<repoRoot>`, `-c
      safe.directory=<repoRoot>`, and `-c core.hooksPath=/dev/null`; pass `--no-verify` on commit;
      replace `http.extraheader` argv with `GIT_CONFIG_COUNT=1`,
      `GIT_CONFIG_KEY_0=http.extraheader`, and `GIT_CONFIG_VALUE_0=AUTHORIZATION: basic <token>` in the
      git child's environment; assert `GIT_DIR/config` contains no credential after the push.
- [X] T099 Add the egress probe to `prepareAgentWorkspace` in `src/agent/workspace.ts` and call it from
      `src/agent/main.ts` before `agent:ack`: as the egress uid, a work-tree write must succeed while
      `GIT_DIR` is unreadable/unwritable, no `.git` exists in the work tree, and `node_modules/` is
      unwritable. Any inverted result throws a workspace error with reason `environment`. Accept a
      `uid`/`spawnProbe` seam so the probe is unit-testable without root.
- [X] T100 [P] Update `.github/workflows/agent-run.yml`: write a mode-`0600` `AGENT_ENV_FILE`
      containing `GITHUB_TOKEN` and `ANTHROPIC_API_KEY`; run the `run` mode through
      `sudo --preserve-env=GITHUB_EVENT_PATH,GITHUB_EVENT_NAME,GITHUB_REPOSITORY,GITHUB_RUN_ID,GITHUB_WORKSPACE,RUNNER_TEMP,AGENT_EGRESS_UID,AGENT_ENV_FILE`
      with `"$(command -v node)" dist/src/agent/main.js run`; leave `prepare` unprivileged.
- [X] T101 [P] Update `.github/workflows/agent-command.yml` with the same env-file and `sudo
      --preserve-env` handoff for the `command` mode; leave `prepare` unprivileged.
- [X] T102 [P] Update `.github/scripts/agent-egress.sh`: after applying the rules, verify that the
      egress user can traverse to `$GITHUB_WORKSPACE` (execute on each ancestor, not listing) and fail
      closed with a clear `agent-egress:` message when it cannot.
- [X] T103 [P] Update `tests/fake-github.ts`: inject
      `runtime: {nodePath: process.execPath, entry: <dist/tests/stub-pi.js>, version: "1.4.0"}` instead
      of `piCommand`/`argPrefix`/`piVersion`; keep `STUB_PI_*` behaviour and the no-token assertion.

**Checkpoint**: `npm test` compiles; the stub-backed run reaches `finished`; the workflow YAML parses;
and `rg '"1\.4\.0"' src/` finds no hardcoded version.

---

## Phase 11: User story re-validation on the provisioned runtime

**Purpose**: Prove each existing story still works when Pi is resolved from the package and runs under
the egress uid. These are verification tasks; the feature behaviour is unchanged.

### User Story 1 — Provisioned Pi answers a request (Priority: P1) 🎯 MVP

- [X] T104 [P] [US1] Add `tests/integration/pi-launch.test.ts`: assert the spawned command is
      `process.execPath` with the resolved `entry`, `--mode rpc` is present, no bare `pi` is spawned,
      the child environment contains `ANTHROPIC_API_KEY` but no `GITHUB_TOKEN`/`GH_TOKEN`, and `cwd` is
      the repository root.
- [X] T105 [US1] Update `tests/integration/run-lifecycle.test.ts`: the `agent:ack` reports the injected
      runtime version (not a constant), the run reaches `finished` against the stub, and a runtime
      resolution failure posts `agent:error`/`environment` without an acknowledgement.

### User Story 2 — Proposal still cannot execute agent-controlled git

- [X] T106 [P] [US2] Add `tests/integration/workspace-git.test.ts`: git is invoked with the separate
      `GIT_DIR`/work tree, `core.hooksPath=/dev/null`, and `--no-verify`; the push token appears in the
      child environment via `GIT_CONFIG_VALUE_0` and in no argument; `GIT_DIR/config` is clean after the
      push.

### User Story 3 — Progress and halt still work with the detached process group

- [X] T107 [P] [US3] Update `tests/integration/halt-boundary.test.ts` and
      `tests/integration/budget-stop.test.ts`: the `abort` boundary still fires when the child is a
      detached group leader, and teardown reaps the group before the diff is collected.

### User Story 4 — Configuration and Pi upgrade change the fingerprint

- [X] T108 [P] [US4] Extend `tests/unit/messages.test.ts`: `renderAck` renders the supplied
      `piVersion` and fingerprint (no built-in `"1.4.0"` default), and the S14 Pi-upgrade variant in
      `quickstart.md` is consistent with the rendered fields.

### User Story 5 — Egress and workspace boundaries fail closed

- [X] T109 [P] [US5] Add `tests/unit/egress-preflight.test.ts` (or extend the workspace test): a
      work-tree write succeeds; writes to `GIT_DIR`, a `.git` entry in the work tree, and
      `node_modules/` are rejected; a missing egress user or a non-root orchestrator with
      `AGENT_EGRESS_UID` set fails with `environment`. Inject the uid/probe seam from T099; do not
      require root in the test suite.

**Checkpoint**: T104–T109 pass with the stub, and each story's existing integration test is green.

---

## Phase 12: Amendment Polish & Sandbox Validation

- [X] T110 [P] Update `.agent/README.md`: the Pi version is pinned by
      `package.json`/`package-lock.json`, is not editable in `.agent/config.yml`, participates in the
      fingerprint, and requires no global install.
- [X] T111 [P] Update `specs/001-issue-driven-agent-workflow/quickstart.md` S15 and the troubleshooting
      table to match the implemented log line, `AGENT_ENV_FILE`, `GIT_DIR`, and `pkill` reap commands.
- [X] T112 [P] Update `specs/001-issue-driven-agent-workflow/plan.md` §"Implementation Notes" with any
      divergence from D16/D17 discovered during implementation; do not change requirements.
- [X] T113 Run `npm ci --ignore-scripts && npm run build && npm test` and `npm run typecheck`; fix any
      failures in `src/agent/**` or `tests/**`; record the new unit/integration counts.
- [X] T114 [P] Static audit: `rg -n '"1\.4\.0"' src/` (no hardcoded version),
      `rg -n 'spawn\("pi"|spawnSync\("pi"' src/` (no bare `pi`), and
      `rg -n 'http\.extraheader' src/` (credential only via git environment); each result must be empty
      or explained in `plan.md` §"Implementation Notes".
- [ ] T115 [P] Sandbox validation: run `quickstart.md` S15 on a clean `ubuntu-24.04` runner with no
      global `pi`; verify uid 0 orchestrator/uid `AGENT_EGRESS_UID` child, `GIT_DIR` isolation,
      no token in `argv` or `environ`, and the `pkill` reap.
- [ ] T116 [P] Sandbox regression: rerun S1, S2, S5, S13, and S14 with the provisioned runtime; record
      the results in `quickstart.md` or the validation issue.
- [X] T117 Security review: confirm `AGENT_ENV_FILE` is unlinked before Pi starts, `GIT_DIR` is
      root-owned `0700` and outside the work tree, `.git` is absent from the work tree, `node_modules/`
      is unwritable by the egress uid, and no credential reaches `GIT_DIR/config`; record findings in
      `specs/001-issue-driven-agent-workflow/plan.md` §"Implementation Notes".
- [X] T118 Re-read `.specify/memory/constitution.md` and audit every new comment, identifier, log line,
      test name, and document for English-only content (constitution I, FR-019).
- [X] T119 Update `specs/001-issue-driven-agent-workflow/tasks.md` §"Implementation Status" with the
      amendment's completed/open tasks and the new test counts.
- [X] T120 Mark the amendment in `specs/001-issue-driven-agent-workflow/plan.md` as **Implemented**,
      link the implementing commit, and record any remaining sandbox-only task.

---

## Amendment Dependencies & Execution Order

### Phase dependencies

- **Phase 9 (T091–T095)**: starts immediately; blocks Phase 10.
- **Phase 10 (T096–T103)**: depends on Phase 9; blocks Phase 11.
- **Phase 11 (T104–T109)**: depends on Phase 10; each story verification can run in parallel.
- **Phase 12 (T110–T120)**: depends on all desired story verifications.

### Within Phase 9

- T091 → T092 → T093.
- T091 → T094 → T095.
- The T092/T093 branch and the T094/T095 branch can run in parallel after T091.

### Within Phase 10

- T096 → T097.
- T097 → T098 → T099.
- T100, T101, T102, and T103 can run in parallel once T097/T099 are complete.
- T103 must not be merged before T096/T097, or the harness will still pass `piCommand`.

### Within Phase 11

- T104 and T105 depend on T103.
- T106 depends on T098/T099.
- T107 depends on T096.
- T108 depends on T094.
- T109 depends on T099.
- T104, T106, T107, T108, and T109 touch different files and can run in parallel; T105 shares
  `tests/integration/run-lifecycle.test.ts` with the harness and should follow T104.

### Story independence

- The amendment enables all stories; it does not change their behaviour. Each story verification is
  independently runnable against the stub, and a failure in one does not block the others after Phase
  10.

---

## Amendment Parallel Example

```bash
# After T091: resolution and fingerprint branches
Task: "T092 Add resolvePiRuntime to src/agent/pi-runtime.ts"
Task: "T094 Add piVersion to computeFingerprint in src/agent/config.ts"

# After T097/T099: job wiring and harness
Task: "T100 Update .github/workflows/agent-run.yml with the sudo handoff"
Task: "T101 Update .github/workflows/agent-command.yml with the sudo handoff"
Task: "T102 Harden traversal check in .github/scripts/agent-egress.sh"
Task: "T103 Inject a stub runtime in tests/fake-github.ts"

# After the harness: story re-validation
Task: "T104 Add tests/integration/pi-launch.test.ts"
Task: "T106 Add tests/integration/workspace-git.test.ts"
Task: "T107 Update tests/integration/halt-boundary.test.ts"
Task: "T108 Extend tests/unit/messages.test.ts for the ack version"
Task: "T109 Add tests/unit/egress-preflight.test.ts"
```

---

## Amendment Implementation Strategy

### MVP for the amendment (T091–T105)

1. Complete Phase 9: Pi resolves from the package, the version is asserted, and the fingerprint includes
   it.
2. Complete T096–T099: the session spawns the resolved runtime, the workspace has a separate `GIT_DIR`,
   and the egress preflight fails closed.
3. Complete T100–T103: the two Pi-spawning workflows use the sudo handoff and the test harness injects
   the stub runtime.
4. Complete T104–T105: the spawn shape is asserted and US1's run lifecycle is green.
5. **STOP and validate**: no global `pi`, `PATH=/usr/bin:/bin`, US1 round trip.

This is the smallest increment that makes the reported symptom disappear. Everything after it hardens
the privilege/workspace boundary and re-validates the other stories.

### Incremental delivery

1. Phase 9 → runtime resolution + fingerprint.
2. Phase 10 → privilege handoff, workspace, workflows.
3. Phase 11 → US1–US5 re-validation.
4. Phase 12 → docs, static audit, sandbox S15/regressions, status.

### Non-negotiables

- T098/T099 (separate `GIT_DIR`, `node_modules` read-only) must land before T106 or the workspace test
  will pass against an unsafe layout.
- T097's "no acknowledgement on a runtime/privilege failure" must land before T105, otherwise the test
  encodes the old misleading ack.
- T117 (security review) is not optional: the root orchestrator is introduced by this amendment.

---

## Amendment Traceability

| Concern | Tasks |
|---|---|
| Blocker 1: Pi provisioning | T091–T095, T096, T104, T105, T114 |
| Blocker 2: privilege handoff | T097–T103, T106, T107, T109, T117 |
| FR-002, FR-034 (runs off-machine, egress) | T097, T099, T102, T109, T115 |
| FR-014, research D5/D16 (fingerprint, no stale session) | T094, T095, T108 |
| FR-018, FR-021, SC-010 (no credential leak) | T097, T098, T099, T106, T117 |
| FR-031, SC-013 (no retry, resume without repeat) | T107 |
| SC-005 (reconstructable record) | T105, T108 |
| SC-015 (explicit trigger) | T105 |
| Constitution I, FR-019 (English artifacts) | T118 |
| Quickstart S15 | T111, T115, T116 |

---

## Amendment Notes

- [P] means a different file and no dependency on an incomplete task; it is not a priority signal.
- Every task that changes a workflow must keep `permissions` at the documented minimum; do not add a
  permission to make Pi or git easier.
- Do not commit `dist/`, `node_modules/`, session files, or the mode-`0600` `AGENT_ENV_FILE`.
- The root orchestration is deliberate and limited to the two Pi-spawning modes; `prepare`, `proposal`,
  and `sweep` stay unprivileged.
- The amendment is complete only when T115/T116 have run on a hosted runner; the unit and stub tests
  cannot prove uid, iptables, or traversal behaviour.
