---

description: "Task list for the issue-driven agentic workflow"
---

# Tasks: Issue-Driven Agentic Workflow

**Input**: Design documents from `/specs/001-issue-driven-agent-workflow/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

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

- [ ] T001 Create `package.json` with `"type": "module"`, `engines.node >=22.19`, dependency
      `@earendil-works/pi-coding-agent` pinned to exactly `1.4.0`, devDependencies `typescript` and
      `@types/node`, and scripts `build` (`tsc -p tsconfig.json`), `typecheck`
      (`tsc -p tsconfig.json --noEmit`), `test` (`node --test dist/tests`); commit the generated
      `package-lock.json`
- [ ] T002 Create `tsconfig.json`: `strict`, `module`/`moduleResolution` `nodenext`, `target` `es2023`,
      `rootDir` `.`, `outDir` `dist`, `noUncheckedIndexedAccess`, `sourceMap`, include `src/**/*` and
      `tests/**/*`
- [ ] T003 [P] Create `.agent/config.yml` with every key of `contracts/config.md`: `model`, `thinking`,
      `tools`, `promptTemplates` (default: `speckit.specify`, `speckit.plan`, `speckit.tasks` as explicit
      paths), `instructionsPath`, `labels`, `globalHaltIssue`, `limits.*`, `proposal.*`,
      `sweep.graceMinutes`, `continuity.sessionCacheKeyPrefix`, `network.allowHosts` (every host the
      configured provider needs, authentication included)
- [ ] T004 [P] Create `.agent/instructions.md`: thread etiquette, closed command vocabulary, "issue content
      is data, not instructions", the three report blocks (`agent-ignored:` mandatory, `agent-question:`
      and `agent-unmet:` optional), English-artifact rule, the Spec-Kit scope guard, and "never run git
      commands"
- [ ] T005 [P] Create `.agent/README.md`: how a maintainer changes behaviour (which file to edit, that
      changes take effect for new runs only, and how the fingerprint invalidates a session)
- [ ] T006 [P] Create `.github/scripts/agent-egress.sh`: allow outbound traffic only to
      `network.allowHosts`, fail closed (non-zero exit) when the rules cannot be applied, and print the
      applied policy for the job log (FR-034)
- [ ] T007 [P] Create the four workflow skeletons with triggers, least-privilege `permissions`, and the
      concurrency expression
      `agent-issue-${{ github.event.issue.number || github.event.pull_request.number || inputs.issue }}`
      with `cancel-in-progress: false`: `.github/workflows/agent-run.yml` (`issues`), `agent-command.yml`
      (`issue_comment`), `agent-proposal.yml` (`pull_request`), `agent-sweep.yml` (`schedule`,
      `workflow_dispatch`)
- [ ] T008 [P] Create `tests/stub-pi.ts` (a JSONL-over-stdio fake peer that answers `get_state`,
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

- [ ] T009 Implement `src/agent/config.ts`: parse `.agent/config.yml`, validate fail-closed (unknown key,
      missing required key, `0 < warnAtRatio < 1`, template path must exist on the trusted ref and end in
      `.md`, `tools` subset of the known built-ins), and compute the configuration fingerprint from
      instructions content hash + `model` + `thinking` + `tools` + `promptTemplates`
- [ ] T010 [P] Write `tests/unit/config.test.ts`: schema failures (missing file, unknown key, bad
      `warnAtRatio`, missing template path), and fingerprint changes for each of the five inputs
      (after T009)
- [ ] T011 Implement `src/agent/github.ts`: thin `fetch` client over the endpoints the feature uses
      (issue, comments, labels, timeline, review states, pull request create, pull request read, repo
      collaborator permission), with pagination, `403` rate-limit backoff for bookkeeping calls, and typed
      errors; the module must expose **no** merge/approve/force-push method (FR-008)
- [ ] T012 Implement `src/agent/events.ts`: map an event payload to a `Trigger` with
      `origin` ∈ {`label`,`retry-command`,`continue-command`}, `event`, `actor`, `at`, `commandId`, plus a
      request snapshot (`requestText`, `requestVersion` = `updated_at` + body hash); `issues.opened` may
      never produce a run without the request label (FR-026)
- [ ] T013 Implement `src/agent/permissions.ts`: decide "write access and above" through the collaborator
      permission endpoint, with a re-check function used at every decision point (FR-024, FR-025)
- [ ] T014 [P] Write `tests/unit/permissions.test.ts`: allowed/denied roles, and a demotion between
      trigger and decision being refused (after T013)

### Record: messages, markers, state log, labels

- [ ] T015 Implement `src/agent/messages.ts`: the ten templates of `contracts/thread-messages.md`
      (`agent:ack`, `agent:status`, `agent:feedback`, `agent:result`, `agent:error`, `agent:decision`,
      `agent:limit`, `agent:session`, `agent:notice`, `agent:outcome`) as fixed English strings with
      data interpolation only, plus the `agent-ignored:` block parser for `agent:notice`
- [ ] T016 [P] Write `tests/unit/messages.test.ts`: every template contains its marker and no
      non-English literal, and no template body contains a literal credential (redaction itself is
      asserted in the `redact` test) (after T015)
- [ ] T017 Implement `src/agent/redact.ts`: known credential shapes and known job secret values replaced by
      `[redacted]`, with a flag the caller records when a redaction happened (FR-018, SC-010)
- [ ] T018 [P] Write `tests/unit/redact.test.ts`: token-shaped strings, `.env` values, and a non-secret
      control string (after T017)
- [ ] T019 Implement `src/agent/thread.ts`: read the issue and its comments, locate messages by marker,
      post idempotently (`marker + runId + kind`), append new messages, and rewrite only the
      `agent:status` body from its own rows (never touching earlier rows)
- [ ] T020 Implement `src/agent/state-log.ts`: append a row (`at`, `state`, `runId`, `consumed`,
      `next act`), keep rows chronological and immutable, assert newest row equals the `State:` line, and
      reconcile the label to the newest row (invariant I2, authoritative direction: log → label)
- [ ] T021 [P] Write `tests/unit/state-log.test.ts`: append-only behaviour, idempotent re-render, row/label
      reconciliation, and a duplicate event producing no second row (after T020)
- [ ] T022 Implement `src/agent/labels.ts`: the transition table of `contracts/labels.md` including the
      `unexpected-retry` failure edge, one-state invariant, terminal stickiness, request-label
      remove-then-add lifecycle, and duplicate `labeled` handling
- [ ] T023 [P] Write `tests/unit/labels.test.ts`: I1 (one state label), I3 (terminal stickiness), duplicate
      trigger collapses, request-label re-trigger procedure (after T022)

### Commands, harness session, budget

- [ ] T024 Implement `src/agent/commands.ts`: grammar of `contracts/commands.md` — `/agent` must be the
      first non-whitespace token, case-insensitive word, code fences and mid-sentence mentions are not
      commands, first command wins, decision words `{halt, retry, continue, approve, reject}` versus
      informational `{status, help}`, unknown word → help text
- [ ] T025 [P] Write `tests/unit/commands.test.ts`: mid-sentence, fenced, multiple commands, unknown word,
      and the five decision words mapping to their kinds (after T024)
- [ ] T026 Implement `src/agent/directive-report.ts`: extract the three agent report blocks —
      `agent-ignored:` (`none` or a list), `agent-question:` (one question), `agent-unmet:` (`none` or a
      list) — reject unparsable content, and produce the `agent:notice` payload with its `kind`
      (`directive`, `question`, `unmet`); a missing `agent-ignored:` block yields the explicit "no
      directive report was produced" notice and a state-log note (FR-006, FR-014, FR-030)
- [ ] T027 [P] Write `tests/unit/directive-report.test.ts`: `none`, list, missing, unparsable, and a
      directive text that would look like an instruction (after T026)
- [ ] T028 Implement `src/agent/pi-session.ts`: launch Pi with exactly the flags of
      `contracts/pi-rpc.md` (including `--offline`, `--no-approve`, the five `--no-*` discovery flags, the
      allowlisted `--prompt-template` arguments, `--model`/`--thinking` from config, fingerprinted
      `--session-id`), strip `GITHUB_TOKEN`/`GH_TOKEN` from the child environment, send
      `set_auto_retry false` and `set_auto_compaction false` before the first prompt, assert the effective
      tool list and model through `get_state`, and drive the `turn_end` boundary loop
- [ ] T029 Implement `src/agent/session-accounting.ts`: record one `agent:session` per Pi session
      (`sessionId`, fingerprint, run ids, consumed, `endedBecause`), and compute the per-issue total as the
      sum of documented sessions
- [ ] T030 Implement `src/agent/budget.ts`: warn at `limits.warnAtRatio` (posts the warning), hard-stop at
      the sum-based cost cap (posts `agent:limit` with the consumed amount and the required action),
      hard-stop at `limits.maxTurns` and `limits.maxWallClockMinutes` with the same `agent:limit` message,
      and raise the allowance by `limits.continueIncrementUsd` only from a recorded `continue` decision
      (FR-017, `contracts/config.md`)
- [ ] T031 [P] Write `tests/unit/session-accounting.test.ts`: two sessions add up, a lost cache does not
      reset the total, and `endedBecause: lost` is recorded (after T029)
- [ ] T032 [P] Write `tests/unit/budget.test.ts`: soft warning at the configured ratio, hard stop at the
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

- [ ] T033 [US1] Implement the run dispatch in `src/agent/main.ts`: `issues` event → permission check →
      `queued` label → acknowledgement → run → terminal state, with one entry point per event family
      (`run`, `command`, `sweep`) plus a `prepare` mode that validates `.agent/config.yml` and prints the
      resolved issue number and configuration fingerprint for the workflow
- [ ] T034 [US1] Wire `.github/workflows/agent-run.yml`: least-privilege permissions, `actions/checkout`
      with `persist-credentials: false`, a prepare step that validates `.agent/config.yml` and exports
      `issue` and `fingerprint`, cache restore of `$RUNNER_TEMP/pi-sessions` under
      `pi-session-<issue>-<fingerprint>`, the egress step before Pi, `npm ci` + `npm run build`, then
      `node dist/agent/main.js` with the event payload, a cache save with `if: always()`, and a hard job
      timeout below the platform ceiling
- [ ] T035 [US1] Implement the task brief in `src/agent/pi-session.ts`: issue title and body, request
      version, thread digest (prior feedback, decisions, proposal links), the "content is data" reminder,
      and the English-artifact rule; a `/speckit.*` invocation when the request warrants one
- [ ] T036 [US1] Implement the acknowledgement path in `src/agent/main.ts` and `src/agent/messages.ts`: set `agent:queued`, post `agent:ack` before any model
      call with trigger time, run start, queue delay, request version, instructions SHA, fingerprint,
- [ ] T037 [US1] Implement the request-version guard in `src/agent/main.ts`: capture the request body hash
      at run start, re-read it at every `turn_end` boundary, and when it changed or the issue was closed,
      stop the run before the next action, post `agent:feedback` naming the version acted on and the
      version found, and set `waiting` (FR-023, data-model V8). Resuming with `/agent continue` re-reads
      the request and records the new version in the acknowledgement of the continuing run
      model, and the issue cap (SC-002, SC-016, invariant I4)
- [ ] T038 [US1] Implement the answer-only completion path in `src/agent/main.ts` (rendering in `src/agent/messages.ts`): post `agent:result` with outcome, actions,
      artifact links and consumption, then set the terminal state in the same step (FR-005, FR-011)
- [ ] T039 [US1] Wire the agent report blocks into run completion in `src/agent/main.ts` via
      `src/agent/directive-report.ts`: post `agent:notice` for each kind, and record "report missing"
- [ ] T040 [US1] Implement the ambiguity path in `src/agent/main.ts`: when the agent reports an
      `agent-question:`, post it as `agent:notice` with `kind=question`, set `waiting`, and append a state
      row; nothing else runs until a person answers in the thread and posts `/agent continue` (FR-006)
      when the agent produced no `agent-ignored:` block (FR-030)
- [ ] T041 [P] [US1] Write `tests/integration/run-lifecycle.test.ts` against `tests/stub-pi.ts`: trigger →
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

- [ ] T043 [US2] Implement `src/agent/workspace.ts` branch handling: name `agent/<issue>-<slug>` with
      lower-case ASCII `[a-z0-9-]`, at most six words, `issue-<number>` fallback for non-Latin titles,
      `-2`/`-3` suffix instead of force-push, created from the default branch head and recorded in the
      acknowledgement
- [ ] T044 [US2] Implement diff collection and commit in `src/agent/workspace.ts`: exclude `dist/`,
      session files and `.git`, apply the `proposal.maxChangedPaths` / `proposal.maxDiffLines` bounds
      (`request-too-large`), redact before commit, abort with `secret-request` and commit nothing when a
      credential is detected, and use the fixed English message `agent: <summary> (#<issue>)` (≤72 chars,
- [ ] T045 [US2] Implement the push in `src/agent/workspace.ts`: push `agent/<issue>-<slug>` with a
      per-job credential supplied for that one command only (`git -c http.extraheader="AUTHORIZATION:
      basic <base64>"` or a `GIT_ASKPASS` helper), never written to `.git/config`; remove it immediately
      afterwards and assert that the workspace git config contains no token. A push without a usable
      credential fails the run with `environment`, and a rejected push (protected branch,
      non-fast-forward) fails with `content-conflict` (FR-021, research D10 layer c)
      fallback `address issue <number>`)
- [ ] T046 [US2] Implement `src/agent/proposal.ts`: open the pull request (base default branch, head
      `agent/…`, `agent:proposal` label, no reviewers, not a draft) with the English body containing the
      issue link, what changed, what was not done, how it was verified, and the request version; link it in
      the thread and set `waiting` with `next act = review the proposal`
- [ ] T047 [US2] Ensure the proposal path cannot apply changes: no merge/approve endpoint in
      `src/agent/github.ts`, `/agent approve` only annotates, and a default-branch push is impossible with
      the credential the orchestrator uses (FR-007, FR-008)
- [ ] T048 [P] [US2] Write `tests/unit/proposal.test.ts`: branch naming including the non-Latin fallback
      and suffix behaviour, bounded diff rejection, redaction abort, a client with no merge capability, and
      a push helper that carries its credential as an argument or askpass value, never as a config entry
      (after T043–T047)
- [ ] T049 [US2] Wire `.github/workflows/agent-proposal.yml` for `pull_request` `closed` and `review`
      events with the same permission gate and a resolved issue number from the branch name or body link
- [ ] T050 [US2] Implement review decisions in `src/agent/proposal.ts`: `approved` → `approve`,
      `changes_requested` → `reject`, mirrored into the thread as `agent:decision` with source `review` and
      actor/timestamp, ignoring reviews from accounts without write access
- [ ] T051 [US2] Implement close handling in `src/agent/proposal.ts` and `src/agent/labels.ts`: on `pull_request.closed` record `agent:outcome` and a decision
      with source `close`, set `finished` when merged and `rejected` when not, and append the state row in
      the same operation (FR-033)
- [ ] T052 [P] [US2] Write `tests/integration/proposal-outcome.test.ts`: review decision recorded, merged
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

- [ ] T054 [US3] Implement the status refresh in `src/agent/main.ts`: on every `turn_end` boundary append a
      state row and update `Consumed`, `Proposal` and `Next act needed`, so no follow-up question is needed
      (SC-007)
- [ ] T055 [US3] Implement failure classification in `src/agent/messages.ts` and `src/agent/main.ts`: the
      enum of `contracts/thread-messages.md` incl. `unexpected-retry`, a requester-actionable vs
      environmental split, and the "can you fix it?" line (FR-012)
- [ ] T056 [P] [US3] Write `tests/integration/retry-signal.test.ts`: a `summarization_retry_scheduled`
      or `willRetry` event aborts the run, fails it with `unexpected-retry`, and the thread names the
      signal (after T055)
- [ ] T057 [US3] Guarantee end states in `src/agent/main.ts` and `src/agent/state-log.ts`: write the terminal label in the same step as the terminal comment,
      and treat a missing `endedAt` as a defect that fails the run rather than leaving `working`
      (FR-011, invariant I3)
- [ ] T058 [P] [US3] Write `tests/integration/budget-stop.test.ts`: the limit stops the run at a
      boundary, posts `agent:limit`, sets `waiting`, and nothing continues without `/agent continue`
      (after T030)
- [ ] T059 [US3] Implement `src/agent/reconcile.ts`: resolve `working` issues older than
      `sweep.graceMinutes` to `failed`/`interrupted`, repair half-applied state-label changes, and ignore
      issues an active job owns (invariant I5, `contracts/config.md`)
- [ ] T060 [US3] Wire `.github/workflows/agent-sweep.yml`: `schedule` plus `workflow_dispatch`, dry-run
      mode, and a summary line of what it repaired
- [ ] T061 [P] [US3] Write `tests/unit/reconcile.test.ts`: interrupted run resolves, half-applied labels
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

- [ ] T063 [US4] Load `.agent/instructions.md` from the trusted-ref checkout and pass it via
      `--append-system-prompt`; record its path, commit SHA and short hash in `agent:ack` (FR-014)
- [ ] T064 [US4] Enforce the prompt-template allowlist in `src/agent/config.ts` and `src/agent/pi-session.ts`, and assert at startup that every
      configured command exists; a missing or non-allowlisted template fails the run with `environment`
      before any model call (research D13)
- [ ] T065 [P] [US4] Write `tests/unit/templates.test.ts`: allowlisted templates only, missing path fails
      validation, an out-of-repository path fails, a non-allowlisted slash command stays plain text
      (after T064)
- [ ] T066 [US4] Enforce "new work only" for configuration in `src/agent/pi-session.ts` and
      `src/agent/config.ts`: fingerprint-scoped session id and cache key, a cold start with the thread
      digest on mismatch, no reuse of a session under changed rules, and a "cold start" note in the
      acknowledgement when the cache was missing; `agent:session` reports `endedBecause: lost` only when a
      session existed before and then disappeared (FR-014, research D5)
- [ ] T067 [US4] Report an instruction the agent cannot honour through `src/agent/messages.ts`: render the
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

- [ ] T070 [US5] Wire `.github/workflows/agent-command.yml`: `issue_comment` → command parse →
      permission re-check → dispatch into `src/agent/main.ts` without starting a model call for
      informational commands
- [ ] T071 [US5] Implement command dispatch in `src/agent/main.ts`: route decision words to their effects,
      record `agent:decision` with source `command`, actor, reason (redacted) and the applied boundary, and
      answer unknown words with the help text (FR-026)
- [ ] T072 [US5] Implement `src/agent/halt-watch.ts`: poll the thread for commands while a run is active,
      queue them in arrival order, and expose them to the boundary loop only
- [ ] T073 [US5] Implement the halt sequence for `src/agent/main.ts` + `src/agent/pi-session.ts`: at the
      next `turn_end` call `get_state`, post `agent:feedback` (completed / not done / state to resume from,
      consumed), then `abort`, then wait for `agent_settled`, then `halted` (FR-027, FR-028, SC-009)
- [ ] T074 [US5] Implement the repository-wide halt in `src/agent/commands.ts` and `src/agent/main.ts` via `config.globalHaltIssue`: block new work until
      lifted, state the scope in the reply, and reflect the blocking state in that issue (FR-015)
- [ ] T075 [US5] Implement `retry` with lineage in `src/agent/main.ts` and `src/agent/messages.ts`: new run, `continuesRunId` recorded in `agent:ack` and the
      state row, thread shows the attempt sequence (FR-031, FR-032)
- [ ] T076 [US5] Implement `continue` in `src/agent/budget.ts` and `src/agent/main.ts`: resume from `waiting`, raise the allowance by
      `limits.continueIncrementUsd` only for a consumption stop, and record the new allowance
- [ ] T077 [US5] Implement the decision-time permission re-check in `src/agent/permissions.ts` so a person demoted after the trigger can
      no longer halt, retry, continue, approve or reject (FR-025), including the explanation in the thread
- [ ] T078 [US5] Implement `status` and `help` in `src/agent/commands.ts` as informational replies that never change state and never
      create a decision record
- [ ] T079 [P] [US5] Write `tests/integration/halt-boundary.test.ts`: halt during a turn produces `abort`
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
- [ ] T082 [P] Add the output scan: every thread body and every committed file passes `redact.ts`, and a
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
- [ ] T087 [P] Pin and audit dependencies in `package.json`: `@earendil-works/pi-coding-agent` exactly `1.4.0`, `npm audit`
      reviewed, and no new runtime dependency added (plan §Primary Dependencies)
- [ ] T088 Run the full `quickstart.md` sequence S1–S14 once against a sandbox repository, including
      every negative variant and the human-only check S10 (third-party reconstruction from the issue
      alone), and record each expected outcome
- [ ] T089 Compare the implementation against `plan.md` §"Design Decisions" and update the plan where the
      implementation legitimately diverged (no silent drift)
- [ ] T090 Review `src/agent/**` and `tests/**` for English identifiers, comments and test names (the
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
