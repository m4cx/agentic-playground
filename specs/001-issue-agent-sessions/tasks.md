# Tasks: Issue-Driven Agent Sessions

**Input**: Design documents from `specs/001-issue-agent-sessions/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Included because `plan.md` commits to a `node:test` strategy and the constitution's
verification workflow requires executable evidence for the success criteria. Test tasks are written
before their implementation and must fail first.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated as an
independent increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: `[US1]`, `[US2]`, `[US3]`, `[US4]` for user-story phases only
- Every task names the exact file or command it touches

## Path Conventions

Single project at the repository root: `src/agent/`, `tests/`, `.github/`, `.agent/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the build, configuration, and instruction scaffolding every later task depends on.

- [X] T001 Create `package.json` with `"type": "module"`, `"engines": { "node": ">=22.19" }`, scripts `build` (`tsc -p tsconfig.json`), `typecheck` (`tsc -p tsconfig.json --noEmit`), and `test` (`node --test dist/tests`); dependency `@earendil-works/pi-coding-agent` pinned exactly to `1.4.0`; dev dependencies `typescript` and `@types/node`.
- [X] T002 Run `npm install` to generate `package-lock.json` and verify it pins `@earendil-works/pi-coding-agent` to `1.4.0`.
- [X] T003 Create `tsconfig.json` with `target`/`lib` `es2023`, `module`/`moduleResolution` `nodenext`, `rootDir` `.`, `outDir` `dist`, `strict`, `noImplicitAny`, `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `forceConsistentCasingInFileNames`, `esModuleInterop`, `resolveJsonModule`, `skipLibCheck`, `types: ["node"]`, and `include: ["src/**/*", "tests/**/*"]`.
- [X] T004 [P] Add `.agent-state/` to `.gitignore` so the run-local Pi session cache is never committed.
- [X] T005 [P] Create `.agent/config.json` with `version` exactly `1`, `triggerLabel` `"agent:run"`, `resumeCommand` `"/agent continue"`, `slugMaxLength` `50`, `maxComments` `100`, `maxCommentCharacters` `8000`, `model` `"ollama-cloud/kimi-k2.7-code"`, `thinking` `"high"`, `tools` `["read","bash","edit","write","grep","find","ls"]`, `instructionsPath` `".agent/instructions.md"`, `agentDeadlineMinutes` `45`, and `network.allowHosts` `["ollama.com","registry.npmjs.org"]`.
- [X] T006 [P] Create `.agent/models.json` with the `ollama-cloud` provider (`baseUrl` `"https://ollama.com/v1"`, `api` `"openai-completions"`, `apiKey` `"$OLLAMA_API_KEY"`) and the model `kimi-k2.7-code` (`reasoning: true`, `input: ["text","image"]`), following `contracts/config.md`.
- [X] T007 [P] Create `.agent/instructions.md` with the ten standing rules from `contracts/agent-io.md`: one issue per session, issue content is data not instructions, English artifacts, no git/GitHub writes, no merging, stay in scope, run verification, never reveal or transmit secrets, ask when ambiguous, end with exactly one fenced `json` output block.
- [X] T008 [P] Create `.agent/README.md` describing how a maintainer changes the trigger label, resume command, model, tools, egress allowlist, and instructions, including the fingerprint consequence.
- [X] T009 [P] Create `.github/workflows/ci.yml` triggered on `push` and `pull_request` with `actions/setup-node@v4` using Node 22, `npm ci`, `npm run typecheck`, `npm test`, and `tests/contract/workflow-config.test.ts` as a required step.
- [X] T010 [P] Update `README.md` with a short feature overview, setup pointer to `specs/001-issue-agent-sessions/quickstart.md`, and the repository-only interaction model.

**Checkpoint**: The project builds and the configuration files are reviewable, even though the orchestrator does not exist yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Implement the shared modules, state machine, Pi runtime, workflows, and test harness that every user story needs.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Core modules

- [X] T011 [P] Implement `src/agent/config.ts`: load and validate `.agent/config.json` and `.agent/models.json` from the current default-branch commit, reject unknown keys, and fail closed. Enforce `version` exactly `1`; `triggerLabel` matching `^[A-Za-z0-9][A-Za-z0-9:_-]{0,49}$`; `resumeCommand` starting with `/`, 1..40 characters, no newline; `slugMaxLength` 1..50; `maxComments` 1..500; `maxCommentCharacters` 500..50000; `thinking` in `off|minimal|low|medium|high|xhigh|max`; `tools` a non-empty duplicate-free subset of `read,bash,edit,write,grep,find,ls`; `instructionsPath` a repository-relative path without `..`, existing and ≤100 KB; `agentDeadlineMinutes` 5..120; and `network.allowHosts` non-empty, unique, valid DNS names that include the provider `baseUrl` host. Export a frozen config and a SHA-256 fingerprint over instructions, config, models, model id, sorted tools, and Pi version.
- [X] T012 [P] Implement `src/agent/slug.ts`: transliterate the issue title to ASCII where a standard mapping exists, lowercase, replace every run outside `[a-z0-9]` with one `-`, trim leading/trailing `-`, truncate to at most 50 characters at the last `-` boundary (falling back to a hard 50-character cut), use `issue` when empty, and validate `^[a-z0-9]+(?:-[a-z0-9]+)*$` with length 1..50.
- [X] T013 [P] Implement `src/agent/github.ts`: a thin REST client over the built-in `fetch` with typed methods for `getIssue`, `listComments`, `createComment`, `updateComment`, `addLabel`, `removeLabel`, `getCollaboratorPermission`, `getRepository`, `getBranch`, `createPullRequest`, `listPullRequests`, and `getPullRequest`; use `Authorization: Bearer <GITHUB_TOKEN>`, `Accept: application/vnd.github+json`, and `X-GitHub-Api-Version: 2022-11-28`; never log the token.
- [X] T014 [P] Implement `src/agent/permissions.ts`: call `GET /repos/{owner}/{repo}/collaborators/{username}/permission`, accept only `admin`, `maintain`, or `write`, reject `triage`, `read`, `none`, `404`, and unknown values, and fail with `permission-check` when the API call itself fails. Do not fall back to `author_association`.
- [X] T015 [P] Implement `src/agent/trigger.ts`: parse `issues.labeled` into a label trigger and `issue_comment.created` into a resume trigger; require the configured label for a start, require the resume command on the first line with a word boundary for a resume, reject comments on pull requests, reject `user.type == "Bot"`, reject closed issues, and carry `commentId`, `commandText`, `actor`, `permission`, and `at`.
- [X] T016 [P] Implement `src/agent/state.ts`: define `SessionState` exactly as `accepted | working | waiting | finished | failed | stopped`; `AgentSession` with `id` `issue-<issueNumber>`, `slug` matching `^[a-z0-9]+(?:-[a-z0-9]+)*$` and 1..50 characters, `branchName` `feature/<issueNumber>-<slug>`, `requestVersion`, `baseSha`, `headSha`, `pullRequestNumber`, `createdAt`, `updatedAt`, `lastTrigger`, `runs`, and `lastFailure`; `Run` with `id`, `trigger`, `startedAt`, `endedAt`, `outcome`, `piSessionId`, `commitShas`, `changedPaths`, `verification`, `failureReason`, and `nextAction`; and `StateRecord` with `schema` exactly `1`. Implement the transition table from `data-model.md` and reject invalid transitions with `state-transition`.
- [X] T017 [P] Implement `src/agent/thread.ts`: read the issue and bounded comments, build the session digest from `data-model.md`, find the single `<!-- agent-session-state ... -->` comment, render and update it in place, and post idempotent comments by checking for `<!-- agent-ack:<runId> -->`, `<!-- agent-run:<runId> -->`, and outcome markers before writing.
- [X] T018 [P] Implement `src/agent/messages.ts`: fixed English templates for acknowledgement, result, failure, review outcome, permission denial, and state recovery, plus the `nextAction` map (`finished`: review and merge; `waiting`: answer with `/agent continue`; `failed`: fix the cause and resume; `stopped`: reopen and resume). Render every durable message from validated fields, never from raw model prose.
- [X] T019 [P] Implement `src/agent/redact.ts`: remove the job token, the provider key, `ghs_`, `github_pat_`, `sk-`, bearer tokens, private-key blocks, and configured secret names from every string; fail with `redaction` if redaction makes a required field invalid.
- [X] T020 [P] Implement `src/agent/output.ts`: extract the last fenced `json` block from the final assistant text, reject unknown top-level keys, and validate `summary` English 1..4000 characters; `verification` ≤20 items each ≤500 characters; `openQuestions` ≤10 items, non-empty when `state` is `waiting`; `couldNotComplete` ≤20 items; `prTitle` English 1..120 characters; `prBody` English 1..8000 characters; and `state` exactly `finished | waiting`. Fail with `agent-output` on a missing or invalid block.
- [X] T021 [P] Implement `src/agent/workspace.ts`: clone into the agent-owned workspace, fetch the default branch and the session branch, create the branch from the current default HEAD, check out an existing branch, merge `origin/<default>` with `--no-edit` on resume, detect and expose conflicted paths, compute `git diff --stat`, commit normal changes with the English message from `contracts/branch-and-pr.md`, commit one empty outcome commit for a no-change `finished`/`waiting` run, commit a WIP commit for a failed run with changes, and push with `git push origin HEAD:refs/heads/<branch>` and no force, lease, tags, or deletion.
- [X] T022 [P] Implement `src/agent/pi-runtime.ts`: resolve the Pi CLI from `node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js`, assert package version `1.4.0`, materialize `.agent/instructions.md`, `.agent/config.json`, and `.agent/models.json` from the default-branch commit into a run-local directory, build a filtered child environment without `GITHUB_TOKEN` or `ACTIONS_*`, create a writable run-local `HOME` and session directory, and launch the child as the `agent-egress` UID.
- [X] T023 [P] Implement `src/agent/pi.ts`: start Pi with `--mode rpc`, `--session-id`, `--session-dir`, `--model`, `--thinking`, `--tools`, `--no-approve`, `--no-extensions`, `--no-mcp`, and `--append-system-prompt <run-local>/.agent/instructions.md`; call `set_auto_retry {enabled:false}` and assert `get_state`; send one `prompt`; consume events until `agent_settled` or the deadline; fail with `unexpected-retry` on retry events; call `get_last_assistant_text` and `get_session_stats`; close stdin, then terminate the process group after 10 seconds; on deadline send `abort`, wait briefly, then terminate and fail with `timeout`.
- [X] T024 [P] Implement `src/agent/pr.ts`: find an open pull request with `head=<owner>:<branch>`, create one if absent, reuse and do not rewrite an existing one, use `Agent work for issue #<n>` or the validated `prTitle`, render the English body from `contracts/branch-and-pr.md`, and never merge, approve, or dismiss reviews.
- [X] T025 [P] Implement `src/agent/review.ts`: map `pull_request.closed` with `merged == true` to `finished` and with `merged == false` to `stopped`; map `issues.closed` to `stopped` unless the merge already set `finished`; derive the issue number from `^feature/(\d+)-` or `Closes #<n>`; post one idempotent outcome comment with the actor and timestamp; never delete the branch.
- [X] T026 [P] Implement `src/agent/events.ts`: convert GitHub event payloads into a `Trigger` or `ReviewOutcome`, select `run`, `resume`, or `review` mode, and reject an event that does not match any contract.
- [X] T027 Implement `src/agent/session.ts`: orchestrate a run — read state, gate permissions, post acknowledgement, remove the label, run the agent, parse output, commit/push/PR, render the result or failure, and write the terminal state. This task depends on T011-T026.
- [X] T028 Implement `src/agent/main.ts`: the CLI entry point that reads the event payload path and mode, dispatches to `session.run`, `session.resume`, or `review.handle`, and maps failures to a process exit code plus a structured job-log line. This task depends on T027.

### Workflows and egress

- [X] T029 [P] Create `.github/scripts/agent-egress.sh`: create the `agent-egress` user at UID 1500, resolve every `network.allowHosts` entry to IPv4, allow loopback, established flows, DNS to the configured nameservers, and TCP 443 to the resolved addresses for that UID, install a rate-limited `LOG` rule with prefix `agent-egress-blocked`, drop all other IPv4 and all IPv6 for that UID, fail closed on an empty allowlist or resolution failure, and export `AGENT_EGRESS_UID` / `AGENT_EGRESS_USER`.
- [X] T030 [P] Create `.github/workflows/agent-run.yml`: trigger on `issues: labeled` with `github.event.label.name == 'agent:run'`, set `permissions: contents: write, issues: write, pull-requests: write`, use `concurrency: group: agent-issue-${{ github.event.issue.number }}` with `cancel-in-progress: false`, set up Node 22, `npm ci`, `npm run build`, apply `agent-egress.sh`, and run `node dist/src/agent/main.js run`.
- [X] T031 [P] Create `.github/workflows/agent-resume.yml`: trigger on `issue_comment: created` with a first-line `/agent continue` filter and `!github.event.issue.pull_request` and non-bot author filters, use the same permissions and concurrency group as `agent-run.yml`, and run `node dist/src/agent/main.js resume`.
- [X] T032 [P] Create `.github/workflows/agent-review.yml`: trigger on `pull_request: closed` and `issues: closed`, set `permissions: contents: read, issues: write, pull-requests: read`, use `concurrency: group: agent-review-${{ github.event.pull_request.number || github.event.issue.number }}`, and run `node dist/src/agent/main.js review`.

### Test harness and contract tests

- [X] T033 [P] Create `tests/fixtures/events/` payloads for `issues-labeled.json`, `issue-comment-resume.json`, `pull-request-merged.json`, `pull-request-closed.json`, and `issue-closed.json`, each with the fields consumed by `src/agent/events.ts`.
- [X] T034 [P] Create `tests/fixtures/rpc/` JSONL scripts for a successful run, a waiting run, a failed run, a retry event, and a timeout, matching the Pi RPC records in `contracts/pi-rpc.md`.
- [X] T035 [P] Write `tests/unit/config.test.ts`: valid config, every invalid range, unknown key, missing key, model absent from `models.json`, provider host absent from `allowHosts`, and fingerprint change on instructions change.
- [X] T036 [P] Write `tests/unit/slug.test.ts`: `Fix login timeout` → `fix-login-timeout`, `Überarbeite die Anmeldung` → `ueberarbeite-die-anmeldung`, emoji-only → `issue`, a 120-character title truncates to ≤50 at a hyphen boundary, and every result matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
- [X] T037 [P] Write `tests/unit/state.test.ts`: marker round-trip, `schema` mismatch, issue-number mismatch, invalid slug, invalid branch name, every valid transition, every invalid transition, and recovery from a missing marker with one matching branch and with two matching branches.
- [X] T038 [P] Write `tests/unit/trigger.test.ts`: accepted label, stale label, accepted resume command, command not on the first line, empty remainder, comment on a PR, bot comment, closed issue, and duplicate comment ID.
- [X] T039 [P] Write `tests/unit/permissions.test.ts`: `admin`, `maintain`, `write` accepted; `triage`, `read`, `none`, `404`, unknown, and API failure rejected with `permission-check`.
- [X] T040 [P] Write `tests/unit/redact.test.ts`: job token, provider key, `ghs_`, `github_pat_`, `sk-`, bearer token, private-key block, and a required field that becomes empty (must fail with `redaction`).
- [X] T041 [P] Write `tests/unit/output.test.ts`: valid output, missing JSON block, invalid JSON, unknown key, over-limit summary, too many verification items, `waiting` without open questions, and a `prBody` that claims a merge.
- [X] T042 [P] Write `tests/contract/workflow-config.test.ts`: read `.agent/config.json`, `agent-run.yml`, and `agent-resume.yml` as text and assert the `triggerLabel` and `resumeCommand` values match their workflow filters.
- [X] T043 [P] Write `tests/contract/schema.test.ts`: assert `.agent/config.json` and `.agent/models.json` satisfy the field rules in `contracts/config.md`, and that `StateRecord.schema` is `1` and `AgentOutput` fields match `contracts/agent-io.md`.
- [X] T044 [P] Create `tests/fake-github.ts`: an in-memory implementation of `src/agent/github.ts` with issues, comments, labels, permissions, branches, and pull requests, plus helpers to inspect posted comments and current state.
- [X] T045 [P] Create `tests/fake-rpc.ts`: a scripted Pi RPC peer over an in-memory duplex stream that emits the fixture JSONL, records commands (`set_auto_retry`, `get_state`, `prompt`, `get_last_assistant_text`), and supports retry and timeout scripts.

**Checkpoint**: All foundational modules compile, unit and contract tests can run, and the workflows are defined. User-story work can begin.

---

## Phase 3: User Story 1 — Issue to feature branch (Priority: P1) 🎯 MVP

**Goal**: A labeled issue produces an acknowledgement, a session, a `feature/<id>-<slug>` branch with committed work, a pull request, an English result comment, and a `finished` state.

**Independent Test**: Open a small issue, apply `agent:run`, and confirm the acknowledgement, branch name, commit content, pull request, result comment, and `finished` state without touching the default branch.

### Tests for User Story 1

- [X] T046 [P] [US1] Write `tests/integration/run.test.ts` with `fake-github.ts` and `fake-rpc.ts`: label trigger → acknowledgement → state `working` → commit → push → PR → result comment → state `finished`; also assert the label is removed and the default branch has no new commit.
- [X] T047 [P] [US1] Add assertions to `tests/integration/run.test.ts` for a no-change run: one empty outcome commit, a pull request with the result summary, and a `finished` state.

### Implementation for User Story 1

- [X] T048 [US1] Implement the start path in `src/agent/session.ts`: re-read the issue and verify the trigger label is still present, remove it, create or load the session marker, set `accepted` then `working`, derive the slug with `src/agent/slug.ts`, derive `feature/<issueNumber>-<slug>`, and post the acknowledgement from `src/agent/messages.ts`.
- [X] T049 [US1] Implement the first-run result path in `src/agent/session.ts` and `src/agent/pr.ts`: parse `AgentOutput`, render the English result comment, commit and push via `src/agent/workspace.ts`, find or create the pull request, link branch and PR in the comment, and transition to `finished` or `waiting`.
- [X] T050 [US1] Implement the no-change path in `src/agent/session.ts` and `src/agent/workspace.ts`: create one empty outcome commit, push the branch, open the pull request with the result summary, and still post the result comment and terminal state.
- [X] T051 [US1] Verify `agent-run.yml` wiring end to end: event → `main.js run` → `session.run`, with the config label matching the workflow filter and the egress step exporting the UID used by `pi-runtime.ts`.
- [ ] T052 [US1] Run quickstart scenario S1 in a sandbox repository and record the observed branch, commit, PR, comment, and state against the expected outcomes in `quickstart.md`.

**Checkpoint**: User Story 1 is a complete MVP: one issue becomes one reviewed feature branch.

---

## Phase 4: User Story 2 — Resume the same session (Priority: P2)

**Goal**: An explicit resume signal continues the same session and branch, merges the current default branch first, and does not create a second branch or session.

**Independent Test**: After a completed run, post `/agent continue <instruction>` and confirm the same session, same branch, a default-branch merge, updated commits, and no second branch or PR. An ordinary comment must do nothing.

### Tests for User Story 2

- [X] T053 [P] [US2] Write `tests/integration/resume.test.ts`: pre-seed a finished session and branch, post a resume command, assert the same session and branch, a merge of the current default, an updated PR, and one new result comment.
- [X] T054 [P] [US2] Add tests to `tests/integration/resume.test.ts` for an ordinary comment (no run), a duplicate comment ID (no second run), an unauthorized actor (no run), a closed issue (no run), and a missing branch (recreated with a recovery note).

### Implementation for User Story 2

- [X] T055 [US2] Implement the resume path in `src/agent/session.ts`: parse the resume command, check write access, verify the issue is open, load the existing session, deduplicate by `commentId`, set `working`, and keep the same slug and branch.
- [X] T056 [US2] Implement the default-branch merge in `src/agent/workspace.ts` and `src/agent/session.ts`: fetch the default branch, merge `origin/<default>` into the feature branch with `--no-edit`, expose conflicted paths to the prompt, report unresolved conflicts as `failed`, and never rebase or force-push.
- [X] T057 [US2] Implement session continuity in `src/agent/session.ts` and `src/agent/pi.ts`: restore the Pi session cache by issue and fingerprint, build the thread digest when the cache is missing, reuse the same `piSessionId` when the fingerprint matches, and record the new trigger and run.
- [X] T058 [US2] Implement the resumed result path in `src/agent/session.ts`: render the new result comment with the reused/changed work, update the same PR, and set `finished` or `waiting` without creating a second session or branch.
- [ ] T059 [US2] Run quickstart scenario S2 in `quickstart.md` against a sandbox repository and record that the same branch is updated and the default branch is merged first.

**Checkpoint**: US1 and US2 work together; a session survives multiple runs.

---

## Phase 5: User Story 3 — Review before the default branch (Priority: P2)

**Goal**: The agent's work is reviewed through one pull request per issue branch; a human merge finishes the session, a close without merge stops it, and the thread records who acted and when.

**Independent Test**: Trigger work, confirm the PR is linked and the default branch is untouched, merge as a human, and confirm the issue records the merger and the state becomes `finished`; repeat with a close without merge and confirm `stopped`.

### Tests for User Story 3

- [X] T060 [P] [US3] Write `tests/integration/review.test.ts`: merged PR → `finished` with merger and timestamp; closed-unmerged PR → `stopped`; issue closed → `stopped`; replayed event → no duplicate comment; PR from a non-matching branch → no comment.
- [X] T061 [P] [US3] Add `tests/unit/review.test.ts` coverage for branch-to-issue parsing (`^feature/(\d+)-`), `Closes #<n>` fallback, missing issue reference, and merged/closed mapping.

### Implementation for User Story 3

- [X] T062 [US3] Implement `src/agent/review.ts`: handle `pull_request.closed`, parse the issue number from the branch or `Closes #<n>`, map `merged` to `finished` and unmerged close to `stopped`, record `mergedBy`/`mergedAt` or the closer, and post one idempotent English outcome comment.
- [X] T063 [US3] Implement the `issues.closed` path in `src/agent/review.ts`: set `stopped` unless the merge already set `finished`, preserve the last run information, and post one idempotent outcome comment.
- [X] T064 [US3] Verify `agent-review.yml` wiring: both event types reach `main.js review`, permissions are read/comment-only, and the concurrency group does not collide with an active agent run.
- [ ] T065 [US3] Run quickstart scenario S6 in `quickstart.md` against a sandbox repository and record the merge outcome comment, the `finished` state, and the untouched branch.

**Checkpoint**: The review gate is explicit and the default branch only changes through a human merge.

---

## Phase 6: User Story 4 — Follow the session state (Priority: P3)

**Goal**: The issue thread always shows the session state, the latest result, open questions, not-completed work, and the next action; failures are explicit and never auto-retry.

**Independent Test**: Start a run, observe the state comment change from `accepted` to `working` to a terminal or waiting state, force a failure, and confirm the reason and next action are visible with no automatic retry.

### Tests for User Story 4

- [X] T066 [P] [US4] Write `tests/integration/failure.test.ts`: provider failure → `failed` with reason and next action; timeout → `failed` with `timeout`; retry event → `failed` with `unexpected-retry`; missing output block → `failed` with `agent-output`; no second attempt starts.
- [X] T067 [P] [US4] Add `tests/unit/messages.test.ts` coverage for every state's visible table, result section, and `nextAction` mapping, and assert that no raw model prose is rendered.

### Implementation for User Story 4

- [X] T068 [US4] Implement the visible state comment in `src/agent/thread.ts` and `src/agent/messages.ts`: render the state, session, branch, PR, last run, and request version table from the marker, and update it in place on every transition.
- [X] T069 [US4] Implement the `waiting` outcome in `src/agent/session.ts` and `src/agent/output.ts`: require at least one open question, render it prominently, and instruct the human to answer with `/agent continue`.
- [X] T070 [US4] Implement the failure outcome in `src/agent/session.ts`: map `permission-check`, `environment`, `agent-output`, `unexpected-retry`, `timeout`, `push`, `state-recovery`, and `redaction` to English reason codes and next actions; never retry automatically; preserve any WIP commit on the branch.
- [ ] T071 [US4] Run quickstart scenarios S3, S4, and S5 in `quickstart.md` against a sandbox repository and record the ignored ordinary comment, the unauthorized rejection, and the failed state with no auto retry.

**Checkpoint**: All four user stories are independently functional and visible.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Harden security, prove the measurable outcomes, and finish the operator documentation.

- [X] T072 [P] Implement blocked-egress reporting in `src/agent/session.ts` and `.github/scripts/agent-egress.sh`: read the `agent-egress-blocked` kernel-log entries for the job window and include the count and destinations in the result or failure comment (SC-011).
- [X] T073 [P] Audit token isolation in `src/agent/pi-runtime.ts` and `src/agent/pi.ts`: assert that `GITHUB_TOKEN`, `ACTIONS_*`, and `RUNNER_*` are absent from the child environment, and add `tests/unit/pi-runtime.test.ts` for the filtered environment and the pinned version check.
- [X] T074 [P] Implement the English-conformance backstop in `src/agent/output.ts` and `src/agent/messages.ts`: reject non-Latin-script fields and high ratios of common non-English function words with `agent-output`, and add `tests/unit/language.test.ts`.
- [X] T075 [P] Audit idempotency across `src/agent/thread.ts`, `src/agent/trigger.ts`, and `src/agent/session.ts`: cover duplicate comments, duplicate label events, replayed review events, and re-run workflow attempts; add the missing tests.
- [X] T076 [P] Add performance instrumentation to `src/agent/session.ts`: record trigger time, job start, acknowledgement time, agent start/end, and result time in the run log and state comment, and assert the acknowledgement target in `tests/integration/run.test.ts`.
- [X] T077 [P] Complete operator documentation in `.agent/README.md`, `README.md`, and `specs/001-issue-agent-sessions/quickstart.md`: label creation, secret setup, workflow permissions, branch protection, egress allowlist changes, and the no-force-push/no-auto-merge guarantees.
- [X] T078 [P] Add large-input tests in `tests/unit/thread.test.ts`: comment truncation at `maxComments` and `maxCommentCharacters`, explicit truncation markers, and a prompt that remains valid JSON.
- [X] T079 Run the `typecheck` and `test` scripts from `package.json` at the repository root; fix every failure and ensure `dist/` is not tracked.
- [X] T080 Run `tests/contract/workflow-config.test.ts` and `tests/contract/schema.test.ts`; fix any drift between workflows, config, models, state schema, and agent output.
- [ ] T081 Run quickstart scenario S7 in `quickstart.md` on a runner and record that an undeclared host is blocked, the allowlisted hosts are reachable, and the blocked attempt appears in the kernel log and the thread.
- [ ] T082 Run quickstart scenario S8 in `quickstart.md` with a non-English issue and verify that the issue text is preserved while the thread artifacts, branch name, commit, and PR are English.
- [X] T083 Perform the final constitution review: re-read `.specify/memory/constitution.md`, inspect every generated artifact and code comment for English-only compliance, and record the result in the feature checklist or a short note under `specs/001-issue-agent-sessions/`.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup; blocks every user story.
- **User Story 1 (Phase 3, P1)**: Depends on Foundational.
- **User Story 2 (Phase 4, P2)**: Depends on Foundational and on US1's session/branch primitives; independently testable with a pre-seeded session.
- **User Story 3 (Phase 5, P2)**: Depends on Foundational and on US1's PR creation; independently testable with a pre-seeded PR.
- **User Story 4 (Phase 6, P3)**: Depends on Foundational and on US1's state writing; independently testable with a seeded state marker.
- **Polish (Phase 7)**: Depends on all desired user stories.

### Story completion order

```text
Setup → Foundational → US1 → US2 → US3 → US4 → Polish
                         └────┴────┘
```

US2, US3, and US4 can be developed in parallel after US1, but each must be validated independently.

### Within each story

1. Tests first; confirm they fail.
2. Models and state transitions before services.
3. Services before workflow wiring.
4. Run the story's integration test and quickstart scenario before moving on.

### Parallel opportunities

- Setup: T004-T010 are independent files.
- Foundational: T011-T026 are separate modules; T029-T032 are separate workflows; T033-T045 are separate fixtures and tests.
- US1: T046 and T047 can be written together; T048-T050 share `session.ts` and must be serialized.
- US2: T053/T054 tests are parallel; T055-T058 share `session.ts` and must be serialized.
- US3: T060/T061 tests are parallel; T062/T063 share `review.ts` and must be serialized.
- US4: T066/T067 tests are parallel; T068-T070 share `session.ts`/`messages.ts` and must be serialized.
- Polish: T072-T078 are independent files and can run in parallel; T079-T083 are verification gates.

---

## Parallel Example: Foundational Modules

```bash
# After T001-T010, these modules have no cross-dependencies:
Task: "Implement src/agent/config.ts per contracts/config.md"
Task: "Implement src/agent/slug.ts per contracts/branch-and-pr.md"
Task: "Implement src/agent/github.ts"
Task: "Implement src/agent/permissions.ts"
Task: "Implement src/agent/trigger.ts"
Task: "Implement src/agent/state.ts"
Task: "Implement src/agent/thread.ts"
Task: "Implement src/agent/messages.ts"
Task: "Implement src/agent/redact.ts"
Task: "Implement src/agent/output.ts"
```

## Parallel Example: User Story 1 Tests

```bash
# After T048-T050, these can run together:
Task: "Run tests/integration/run.test.ts for the happy path"
Task: "Run tests/integration/run.test.ts for the no-change path"
```

---

## Implementation Strategy

### MVP first (User Story 1 only)

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 (US1).
3. Run `npm run typecheck`, `npm test`, and quickstart S1.
4. **STOP and validate**: one labeled issue produces one reviewed feature branch and a result comment.

### Incremental delivery

1. Setup + Foundational → the orchestrator, state model, Pi runtime, and workflows exist.
2. US1 → MVP: issue to branch and PR.
3. US2 → session continuity and default-branch freshness.
4. US3 → human review outcomes recorded.
5. US4 → visible state, waiting, and failure handling.
6. Polish → security, language, performance, and operator documentation.

### Parallel team strategy

- One developer owns `session.ts` and serializes US1/US2/US4 work there.
- A second owns `review.ts` and US3.
- A third owns the test harness, contract tests, and quickstart scenarios.
- Setup and foundational modules are split by file, then joined before US1.

---

## Notes

- `[P]` marks tasks that touch different files and do not depend on an incomplete task.
- `[US*]` maps every user-story task to its spec story for traceability.
- Tests must fail before their implementation task starts.
- Commit after each task or logical group; do not commit `dist/` or `.agent-state/`.
- Stop at each checkpoint and validate the story independently before moving on.
- The quickstart scenarios in `specs/001-issue-agent-sessions/quickstart.md` are the manual acceptance gate.

---

## Implementation Status (2026-10-28)

- **Completed**: 77 of 83 tasks.
- **Automated validation**: `npm run typecheck` passes; `npm test` passes 109 tests; all four
  workflow files parse as YAML; `.github/scripts/agent-egress.sh` passes `bash -n`; `package-lock.json`
  pins `@earendil-works/pi-coding-agent` to `1.4.0`.
- **Pending manual sandbox scenarios**: T052 (S1 happy path), T059 (S2 resume), T065 (S6 merge
  outcome), T071 (S3/S4/S5 ignored comment, unauthorized actor, failure), T081 (S7 egress), and
  T082 (S8 language). These require a real GitHub sandbox repository, Actions runtime, provider
  secret, and runner; they cannot be executed in this local workspace. The equivalent lifecycle is
  covered by `tests/integration/run.test.ts`, `resume.test.ts`, `review.test.ts`, and
  `failure.test.ts`.
