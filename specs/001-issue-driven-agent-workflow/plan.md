# Implementation Plan: Issue-Driven Agentic Workflow

**Branch**: `001-issue-driven-agent-workflow` | **Date**: 2026-10-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-issue-driven-agent-workflow/spec.md`

**Amendment**: 2026-10-27 — Pi runtime provisioning in GitHub Actions; see
[§Amendment 2026-10-27](#amendment-2026-10-27-pi-runtime-provisioning-in-github-actions).

**Additional input (this planning round)**: the remote agent must run on the Pi harness
(`pi.dev`, `@earendil-works/pi-coding-agent`), the same harness used locally.

## Summary

Build a workflow that turns a GitHub issue thread into the complete control surface for an
autonomous coding agent running on the Pi harness, with no terminal and no local execution.

A person with write access labels an issue. A GitHub Actions job starts on an ephemeral hosted
runner, reads the issue thread, drives Pi in RPC mode through a small orchestrator, streams the
agent's progress into the thread as status comments, enforces a per-issue consumption limit, and ends
by posting a result comment plus — when the work produced changes — a branch and a pull request that
only a human can merge.

The orchestrator, not Pi, owns every repository credential: Pi runs with no GitHub token and only
filesystem tools, so a successful prompt injection finds no repository authority to abuse, and the
main line can only change through a reviewed pull request.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 22.19+, ESM, `strict` mode, compiled with `tsc` to
`dist/` (no bundler and no runtime transpiler); workflow definitions in GitHub Actions YAML; agent
behaviour in Markdown instructions.

**Primary Dependencies**: `@earendil-works/pi-coding-agent` pinned to the exact version used locally
(1.4.0), consumed through its documented RPC wire protocol. The executable is resolved from the
installed package under `node_modules/` and launched with the running Node binary; `PATH` and any
globally installed `pi` are never consulted (amendment 2026-10-27, research D16). The repository's own Spec Kit prompt
templates are loaded as Pi prompt templates from an explicit allowlist, so a feature-sized issue can
be worked with this repository's `specify` → `plan` → `tasks` workflow. Development dependencies are
`typescript` and `@types/node` only. No other runtime dependencies: GitHub access uses the Node
built-in `fetch`, tests use `node:test`, and the build is plain `tsc`.

**Storage**: No database. Authoritative state lives in the repository: issue labels mirror the run
state, the append-only state log inside the issue's status comment is the state timeline, issue
comments carry the audit record and agent feedback, pull requests carry proposed changes. A per-issue
Pi session file is cached between runs as a best-effort continuity aid, keyed on the issue number and
the configuration fingerprint, and is never authoritative.

**Testing**: `node:test` unit tests written in TypeScript for command parsing, permission gating,
state transitions, budget accounting, redaction, and proposal payloads; a stub RPC peer (JSONL over
stdio) for orchestrator tests that need a Pi-shaped event stream; scripted end-to-end scenarios in
`quickstart.md` against a sandbox repository. Tests are compiled by the same `tsconfig.json` and run
from the build output (`node --test dist/tests`), so the code under test is exactly the code that
runs in the workflow.

**Target Platform**: GitHub-hosted ephemeral Ubuntu runner (`ubuntu-24.04`), triggered by `issues` and
`issue_comment` events for work, by `pull_request` (`closed`, `review` states) for proposal outcomes and
review decisions, and by a `schedule` plus `workflow_dispatch` sweep for reconciliation. Nothing runs on a
contributor machine.

**Project Type**: Single project — a CI-hosted agent service (workflow definitions + orchestrator)
that lives inside the repository it operates on.

**Performance Goals**: acknowledgement comment within 2 minutes of the run starting (SC-002), with the
queue delay recorded per run (SC-016); halt honoured within 5 minutes (SC-009); small request
end to end within 10 minutes (SC-001); one run per issue at a time (FR-013).

**Constraints**: TypeScript `strict` mode, no implicit `any`, no `@ts-ignore` (an unavoidable
suppression carries a comment naming the reason); `dist/` is build output and is never committed; the
workflow installs and builds before the agent starts, cached with `setup-node`. The model ID is pinned
in `.agent/config.yml` (`contracts/config.md` is the single configuration schema); the Pi version has
one home, the exact dependency pin in `package.json` plus `package-lock.json`, which the orchestrator
asserts against the installed package before the first model call (research D16); per-issue
consumption limit with a soft warning and a hard stop
(FR-017); hard job timeout well below the platform's 6-hour ceiling; the orchestrator alone holds
`issues: write`, `contents: write`, and `pull_requests: write`; Pi never receives a repository
credential; all agent-authored content in English (constitution, FR-019).

**Scale/Scope**: One repository, tens of handled issues per month. Runs are serialized per issue by a
concurrency group; no repository-wide concurrency cap is enforced, because concurrency groups cannot
express one (a single global group would serialize to one job). Two simultaneous runs on different
issues are therefore possible and accepted.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution version in force: **2.0.1**. Applicable principle: **I. English for All Generated
Content**, plus the Additional Constraints (scope of "generated content", inbound content in other
languages) and Development Workflow (review must verify the language standard, agents must apply it
to everything they write).

| Gate | Assessment | Result |
|------|------------|--------|
| Generated artifacts in English (comments, commits, branch names, PR text, instructions, code, tests, config keys) | FR-019 makes this a functional requirement; `.agent/instructions.md` restates it for the model; the orchestrator renders every thread message from English templates it owns, so the agent cannot accidentally localise record-keeping; commit and PR templates are fixed English strings | PASS |
| Inbound non-English content preserved, not translated into the record | Issue threads may be non-English. Standing instruction: understand the thread in its own language, answer in the thread's language *inside* agent-authored repository content policy, and keep every committed artifact and every durable record English | PASS |
| Deviation protocol (declare non-English content in spec/plan before implementation) | Not needed: the feature requires no non-English artifact. Documented exceptions (verbatim quotations of external sources) are permitted by the constitution and are not otherwise produced | PASS |
| Review verification of the language standard | Quickstart includes a language-conformance check per handled issue; tasks include it as an explicit verification step | PASS |

No violations; **Complexity Tracking is empty**.

Language note for the Spec Kit capability (D13): the agent may run `/speckit.*` commands whose
artifacts are committed under `specs/**`. Those artifacts are generated content and therefore must be
English, even when the issue thread that requested them is not. `.agent/instructions.md` states this
explicitly, and `quickstart.md` S11 and S12 verify it.

## Project Structure

### Documentation (this feature)

```text
specs/001-issue-driven-agent-workflow/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── commands.md      # Issue-thread command grammar and effects
│   ├── labels.md        # Label state machine and invariants
│   ├── thread-messages.md  # Rendered thread message formats (the UI contract)
│   ├── proposal.md      # Branch + pull request contract
│   ├── config.md        # Single schema for .agent/config.yml
│   └── pi-rpc.md        # Orchestrator ↔ Pi RPC usage subset, session accounting, network policy
├── checklists/
│   └── requirements.md  # Spec quality checklist
├── consistency-and-decision-review.md  # Cross-artifact consistency review and decision re-evaluation
└── tasks.md             # Phase 2 output (/speckit.tasks — not created here)
```

### Source Code (repository root)

```text
package.json                  # ESM, engines >=22.19, scripts: build, typecheck, test
tsconfig.json                 # strict, module nodenext, rootDir ., outDir dist
.github/
├── workflows/
│   ├── agent-run.yml         # issues: opened/labeled → acknowledge, then start a run
│   ├── agent-command.yml     # issue_comment → halt/retry/continue/approve/reject
│   ├── agent-proposal.yml    # pull_request: closed/review → outcome + review decisions
│   └── agent-sweep.yml       # schedule + workflow_dispatch → reconcile stuck runs
└── scripts/
    └── agent-egress.sh       # applies the network allowlist before Pi starts (FR-034)

.agent/
├── instructions.md           # Standing instructions appended to Pi's system prompt
├── config.yml                # Single schema: model, thinking, tools, prompt templates, labels,
│                             # limits, proposal bounds, global halt issue, egress allowlist
└── README.md                 # How a maintainer changes agent behaviour

src/agent/
├── main.ts                   # Entry point: event → dispatch (run, command, sweep, or prepare)
├── events.ts                 # GitHub event payload → Trigger or command input
├── config.ts                 # Load, validate, and fingerprint .agent/config.yml
├── permissions.ts            # Write-access gate and re-check at decision time
├── labels.ts                 # Label state machine (transitions, invariants)
├── commands.ts               # Command-word parsing and validation
├── thread.ts                 # Thread reading, message markers, idempotent posting
├── messages.ts               # English message templates (ack, status, feedback, result, failure,
│                             # session, notice, outcome)
├── state-log.ts              # Append-only status rows, rewrite-without-loss, label reconciliation
├── directive-report.ts       # Parses the agent-ignored: block, renders the agent:notice message
├── session-accounting.ts     # Per-session consumption records and the per-issue sum
├── budget.ts                 # Consumption accounting, soft warning, hard stop
├── pi-runtime.ts             # Resolves the pinned Pi executable and version from node_modules,
│                             # asserts the pin, and builds the unprivileged child environment
├── pi-session.ts             # Pi RPC lifecycle: start, prompt, observe, abort at boundary
├── halt-watch.ts             # Polls the thread for commands while a run is active
├── reconcile.ts              # Sweep: interrupted runs, half-applied label changes
├── workspace.ts              # Repo state, branch creation, diff collection, commit
├── proposal.ts               # Pull request creation, review and close observation
├── redact.ts                 # Secret/credential redaction before posting or committing
└── github.ts                 # Thin REST client over global fetch

tests/
├── fixtures/
│   ├── events/               # Captured GitHub event payloads
│   └── rpc/                  # Recorded Pi RPC event streams
├── stub-pi.ts                # Fake Pi RPC peer for orchestrator tests
├── unit/
│   ├── commands.test.ts
│   ├── permissions.test.ts
│   ├── labels.test.ts
│   ├── state-log.test.ts       # Append-only rows, idempotent rewrite, I1/I2 reconciliation
│   ├── budget.test.ts
│   ├── messages.test.ts
│   ├── redact.test.ts
│   ├── proposal.test.ts
│   ├── config.test.ts          # Schema validation, fingerprint stability, fail-closed
│   ├── templates.test.ts       # Allowlist only; missing path fails before any model call
│   ├── directive-report.test.ts # none / list / missing / unparsable block handling
│   ├── session-accounting.test.ts # per-session records, issue total, cache loss does not reset
│   ├── pi-runtime.test.ts      # Bare PATH, exact-version assertion, entry outside node_modules
│   ├── egress-preflight.test.ts # Work-tree write, GIT_DIR/.git/node_modules boundaries
│   └── reconcile.test.ts       # Interrupted runs resolve; half-applied labels repaired
└── integration/
    ├── run-lifecycle.test.ts   # Trigger → ack → run → result, against the stub
    ├── pi-launch.test.ts       # Spawn shape: node + resolved entry, no PATH/global binary
    ├── workspace-git.test.ts   # Separate GIT_DIR, hooks disabled, credential via env
    ├── halt-boundary.test.ts   # Halt honoured at the next action boundary
    ├── budget-stop.test.ts     # Limit reached → stop → explicit decision required
    ├── retry-signal.test.ts    # Any retry signal aborts and fails with unexpected-retry
    └── proposal-outcome.test.ts # Review decisions and pull-request close resolve the issue

dist/                         # Build output of tsc; git-ignored, never committed
```

**Structure Decision**: Single project. The repository currently holds only Spec Kit configuration,
prompts, and specifications, so this feature introduces the first executable code. It is kept in one
flat `src/agent/` module set rather than layered directories because every module is a single-purpose
piece of one process, and a deep tree would add navigation cost without adding a boundary. The
workflow YAML stays in `.github/workflows/` (platform requirement) and agent behaviour stays in
`.agent/` (reviewable content, not code).

The source language is TypeScript with `strict` enabled, compiled by `tsc` into `dist/`; nothing runs
through a transpiler at runtime and nothing is compiled on the fly. Tests live in the same `tsconfig`
project and are executed from `dist/tests`, so a type error fails the build before the workflow reaches
the agent, and the tests exercise the exact artifact that ships. `dist/` is git-ignored: the repository
holds source, the job holds build output.

## Design Decisions Carried From Research

Full rationale and rejected alternatives are in [research.md](./research.md).

1. **Runtime**: Pi in RPC mode, driven from Node over its documented JSONL protocol.
2. **Credential separation**: the orchestrator holds the repository token; Pi holds only the model
   provider key and filesystem tools. No repository authority inside the agent process.
3. **Configuration surface**: Pi runs with trust-gated project resources disabled, auto-discovery of
   extensions, skills, prompt templates, and MCP servers off, and an explicit instruction file and tool
   allowlist, so behaviour does not depend on whatever `.pi/` content a branch happens to contain. All
   of those values come from `.agent/config.yml` (`contracts/config.md`); no behaviour-affecting
   environment variable is read.
4. **Prompt vocabulary from an allowlist**: named prompt templates — by default this repository's
   Spec Kit templates `speckit.specify`, `speckit.plan`, `speckit.tasks` — are loaded explicitly via
   `--prompt-template`, giving the agent the same `/speckit.*` commands used locally while keeping
   discovery off (research D13). Spec Kit
   performs no git operations here, so it cannot interfere with the orchestrator's branch ownership.
   A startup assertion verifies that every configured command actually loaded.
5. **State**: labels mirror state for visibility; the append-only state log in the single status
   comment is the authoritative timeline; comments carry the record; pull requests carry proposals;
   platform concurrency groups serialize per issue.
6. **Budget**: measured from Pi's own session statistics at each boundary, with a soft threshold and a
   hard stop that requires an explicit command to continue.
7. **No automatic retry, enforced at every layer**: transient-error retry and automatic compaction are
   both disabled, and any remaining recovery-retry signal aborts the run as `unexpected-retry` instead of
   continuing invisibly (research D7).
8. **Credential hygiene in the workspace**: the checkout persists no credentials and the workspace git
   config holds no token, so the agent's shell has nothing to push with (research D10, layer c).
9. **Continuity is configuration-bound**: the Pi session id and cache key include a fingerprint of the
   instructions, model, thinking level, tool allowlist, prompt templates, and the pinned Pi version, and
   each run asserts the effective tools and model before the first prompt (research D5, D16).
10. **Consumption is accounted per session**: each Pi session's cost is documented as its own
    `agent:session` message and the per-issue limit applies to their sum, so a lost cache cannot reset it
    (spec clarification).
11. **The proposal's end is observed, not assumed**: review states count as approve/reject, and
    `pull_request.closed` resolves the issue to `finished` or `rejected` with the responsible person and
    time recorded in the thread (FR-033, research D11).
12. **The agent has no egress**: an allowlist containing only the model provider endpoint is applied
    before Pi starts, Pi runs with `--offline`, and a run that cannot apply the restriction fails with
    `environment` instead of starting (FR-034, research D10).
13. **Directive reports are machine-checkable**: the agent ends its answer with an `agent-ignored:` block
    that the orchestrator parses and renders as an `agent:notice`; a missing block is recorded as missing
    rather than hidden (FR-030, research D14).
14. **Language is TypeScript**: strict TypeScript compiled with `tsc` to `dist/`, not plain JavaScript and
    not JSDoc-annotated JavaScript; tests are TypeScript too and run from the build output (research
    D15).
15. **Pi is provisioned deterministically**: the orchestrator resolves the executable from the pinned
    package under `node_modules/`, asserts the installed version against the exact dependency pin, and
    launches it with the running Node binary. `PATH`, a globally installed `pi`, and an implicit
    `npm install -g` are never used (research D16, amendment 2026-10-27).
16. **Privilege handoff is explicit**: the job steps that can spawn Pi run the orchestrator with the
    privilege needed to start Pi under the egress uid; the work tree is handed to that uid except
    `.git`, which stays orchestrator-owned, and git runs with trust and hook protections (research
    D17, amendment 2026-10-27).

## Decisions Carried From the Consistency Review

All findings of [consistency-and-decision-review.md](./consistency-and-decision-review.md) are resolved and
recorded in `spec.md` §Clarifications. The acknowledgement is posted by the run job and its delay is
recorded per run rather than promised away: SC-002 is measured from the start of the run, and SC-016 makes
the platform queue visible. No open decision remains in this plan.

## Complexity Tracking

> No constitution violations, so no entries. The table below is intentionally absent rather than
> filled with justifications for choices that are not violations.

## Implementation Notes (recorded after implementation)

These notes satisfy T089: the code was compared against the design decisions above, and the
divergences below are deliberate. Nothing here changes a requirement; each item records how the
contracts are met where the plan's structure was not literally executable.

1. **Entry point path.** `tsconfig.json` uses `rootDir: "."` (T002) so tests and sources share one
   project, which puts the compiled entry point at `dist/src/agent/main.js`, not `dist/agent/main.js`.
   The workflows use the actual path. `node --test dist/tests` is unchanged.
2. **Effective-tool assertion.** Pi 1.4.0's documented `get_state` response exposes the model and the
   message counters but not the effective tool list. `assertEffectiveState` therefore compares the
   model always, and compares tools when the response carries them (`tools`, `toolNames`, or
   `effectiveTools`); otherwise `--tools` — an exact replacement selection in Pi — is the authoritative
   allowlist, and `tests/stub-pi.ts` exercises the comparison path. A mismatch fails the run with
   `environment` exactly as the contract requires.
3. **Egress enforcement is per-UID.** `.github/scripts/agent-egress.sh` installs the allowlist with
   iptables owner matching for a dedicated unprivileged user, drops that user's IPv6 traffic, and
   exports `AGENT_EGRESS_UID`. The orchestrator spawns Pi under that UID (chowning the workspace and
   session directory first). This keeps the orchestrator's own GitHub access working while Pi reaches
   only `network.allowHosts`. The script fails closed: an empty allowlist, an unresolvable host, or a
   failure to apply the rules exits non-zero, and the run never reaches a model call.
4. **`agent:session` is posted per run, per session.** Pi's session statistics are cumulative for a
   session, and a session can span several jobs. The orchestrator records the *delta* against the
   statistics observed at session start, keys the message on `sessionId + run id`, and states the
   issue total as the sum of documented records. The accounting rule of the contract (per-issue limit
   applies to the sum; a lost cache cannot reset it) is preserved exactly, and a resumed session is
   not double counted.
5. **Global halt.** A repository-wide halt is active while the issue named by `globalHaltIssue` rests
   in `halted`. New work is refused with an explicit thread message while it is active, and a
   `/agent continue` or `/agent retry` on that issue lifts it (recorded as a decision, state moves to
   `waiting`). This is the smallest mechanism that is observable from the repository alone.
6. **Dependency audit (T087).** `@earendil-works/pi-coding-agent` is pinned to exactly `1.4.0` and no
   other runtime dependency was added. `npm audit` reports 45 low and 2 critical advisories, all inside
   that pinned dependency tree (its own transitive packages, including `undici` and `cross-spawn`).
   The version is fixed by the requirement to run on the harness used locally, so the finding is
   recorded rather than "fixed" by an unplanned upgrade; revisiting the pin is an operator decision.
7. **Remaining sandbox-only work.** Tasks T042, T053, T062, T068, T069, T080, T081, T083 (scenario
   S11), T084 (20-run sample), T085 (forced long conversation), T086 (10 hostile issues), and T088
   require a live sandbox repository with Actions enabled. Everything they validate is
   implemented and covered by the automated suite except the end-to-end platform behaviour itself:
   ack latency, egress enforcement, halt through the Actions UI, job cancellation and reconciliation,
   and the 20-run/10-issue samples.

8. **Pi runtime provisioning (amendment 2026-10-27).** The implementation follows D16/D17 with these
   concrete choices:
   - `src/agent/pi-runtime.ts` resolves the package through `import.meta.resolve`, walks to its
     `package.json`, reads `bin.pi`, and validates the exact pin against the installed and locked
     versions. A failure is `PiRuntimeError`/`environment`; it is reported before `agent:ack` and no
     acknowledgement is posted.
   - The run/command workflows write a mode-`0600` `AGENT_ENV_FILE` outside `sudo`'s environment; the
     orchestrator reads and unlinks it before constructing the GitHub client. `GITHUB_TOKEN` stays in
     the orchestrator; the provider key is used there for redaction and passed to the Pi child, whose
     environment never contains the repository token.
   - `prepareAgentWorkspace` moves `.git` to `$RUNNER_TEMP/agent-git` (root, `0700`), chowns the work
     tree except `node_modules/`, best-effort adds ancestor execute bits, and then probes as the egress
     uid: work-tree and session-cache writes succeed; `GIT_DIR`, `.git`, and `node_modules/` writes fail;
     the Pi entry is readable and Node is executable. The probe is the authority; an unable-to-chmod
     platform ancestor does not silently pass.
   - Git runs with `--git-dir`/`--work-tree`, `safe.directory`, `core.hooksPath=/dev/null`, and
     `--no-verify`; the push credential travels in `GIT_CONFIG_VALUE_0`, never in `argv` or the config.
   - The session cache is handed back to the job user after Pi exits, so `actions/cache/save` can read
     it. `AGENT_CACHE_OWNER_UID`/`AGENT_CACHE_OWNER_GID` are written by the workflow and preserved
     through sudo; the orchestrator falls back to `SUDO_UID`/`SUDO_GID` for manual runs.
   - Pi is spawned as a detached process-group leader with `HOME`/`TMPDIR`/`XDG_CACHE_HOME` under the
     session cache; teardown kills the group and then reaps the egress uid. The reap is best-effort
     (`pkill`/`pgrep`), while the group kill is authoritative.
   - The pinned Pi version participates in the fingerprint, so a Pi upgrade starts a fresh session.
   - Test suite after the amendment: 159 tests (134 unit, 25 integration; all passing), including unit coverage for the runtime
     resolver, egress preflight, and git argument/env shape, plus a spawn-shape integration test.

## Amendment 2026-10-27: Pi runtime provisioning in GitHub Actions

**Status**: Implemented 2026-10-27. Unit and stub-backed integration tests cover the resolution,
privilege, workspace, and launch paths. The hosted-runner checks (quickstart S15 and the S1/S2/S5/S13/S14
regressions) remain open as T115/T116 because they need a live sandbox repository.

### Observed gap

The reported symptom is that Pi is not available in the GitHub Actions context at all. Two independent
blockers on the same launch path confirm it.

**Blocker 1 — the executable is never provisioned.** Every workflow runs
`npm ci --ignore-scripts && npm run build` and then `node dist/src/agent/main.js …`. `npm ci` installs
`@earendil-works/pi-coding-agent` and creates `node_modules/.bin/pi`, but no step adds
`node_modules/.bin` to `PATH`, installs Pi globally, or tells the orchestrator where the executable is.
`PiSession` spawns the literal command `pi` (`src/agent/pi-session.ts`), so it depends on a binary on
`PATH`. That works on a developer machine with a global install (here `/opt/homebrew/bin/pi`, 1.4.0) and
fails on a clean runner.

Verified locally on 2026-10-27:

```text
spawnSync("pi", …, {env: {PATH: "/usr/bin:/bin"}})            -> ENOENT
node node_modules/@earendil-works/pi-coding-agent/dist/bundle/rpc-entry.js --version
                                                              -> 1.4.0
```

**Blocker 2 — the launch cannot drop privileges.** The same path assumes the orchestrator can spawn Pi
under `AGENT_EGRESS_UID` (`spawn(…, {uid})`) and `chown` the workspace, which requires effective uid 0.
The `run` and `command` steps execute as the unprivileged `runner` user (only the egress step uses
`sudo`), so even with Pi resolvable the spawn fails with `EPERM` and the run ends as `environment`.

The existing sandbox-only tasks (T042, T053, T062, T068–T069, T080–T081, T083–T088) explain why neither
blocker surfaced earlier: no end-to-end run ever executed on a hosted runner.

### Decision D16 — resolve Pi from the pinned dependency, never from PATH

The orchestrator resolves the package through Node's export map, derives the package root, reads
`package.json#bin.pi`, and launches that file with `process.execPath`:

```text
piRuntime = {
  nodePath: process.execPath,
  entry:    <repoRoot>/node_modules/@earendil-works/pi-coding-agent/<bin.pi>,
  version:  <installed version>
}
```

Before the acknowledgement the orchestrator resolves this runtime and asserts, failing closed with
`environment` (so a broken runtime produces an error comment, not a false acceptance):

1. the package resolves from `<repoRoot>/node_modules/` and not from a parent or global location;
2. `package.json#dependencies["@earendil-works/pi-coding-agent"]` is an **exact** version, not a range;
3. the installed version and the version recorded in `package-lock.json` both equal that pin;
4. the resolved entry exists, is a file, and is readable and executable by the egress uid.

The resolved version — not a hardcoded constant — is what `agent:ack` reports. `--mode rpc` stays in the
launch arguments because the CLI entry is used. This also removes the duplicated, drifting `"1.4.0"`
literals in `main.ts` and `pi-session.ts`.

The pinned Pi version also joins the configuration fingerprint (`contracts/config.md` Rule 5): an
upgrade changes the session id and cache key, so a session written by an older Pi is never resumed by a
newer one. The fingerprint uses the **locked** version, which `prepare` can read from
`package-lock.json` without executing Pi; the run then asserts that the installed package equals it.

**Rejected alternatives**: adding `node_modules/.bin` to `PATH` (works, but leaves version resolution
implicit and lets a future runner image or global install shadow the pin); `npm install -g
@earendil-works/pi-coding-agent@1.4.0` (a second, non-lockfile install on the critical path); the
in-process SDK (collapses the credential boundary and makes Pi's environment the orchestrator's); the
`rpc-entry` export (viable, but it implicitly forces `--mode rpc` and hides the documented CLI
invocation the contract describes).

### Decision D17 — explicit privilege handoff and workspace ownership

The egress design (FR-034) requires a uid-scoped network policy, which in turn requires the
orchestrator to be able to `setuid`. The job makes that privilege explicit instead of pretending an
unprivileged process can drop privileges:

- `agent-run.yml` and `agent-command.yml` execute the `run` / `command` mode through
  `sudo --preserve-env=…`, invoking Node by absolute path so `sudo`'s `secure_path` cannot change the
  interpreter. The preserved values are the non-secret ones the orchestrator needs
  (`GITHUB_EVENT_PATH`, `GITHUB_EVENT_NAME`, `GITHUB_REPOSITORY`, `GITHUB_RUN_ID`, `GITHUB_WORKSPACE`,
  `RUNNER_TEMP`, `AGENT_EGRESS_UID`, `AGENT_ENV_FILE`). Secrets do not travel through `sudo`'s
  environment: the step writes a mode-`0600` file readable only by the runner and root, and the orchestrator reads it once and unlinks it before
  spawning Pi. This avoids a dependency on the runner image granting `SETENV` for secret variables and
  keeps the token out of any process argument list. `prepare`, `proposal`, and `sweep` stay
  unprivileged: they never spawn Pi.
- Before the acknowledgement, the orchestrator asserts that it is uid 0 when `AGENT_EGRESS_UID` is set.
  If not, the run fails with `environment` and the thread names the missing handoff; it does not fall
  back to running Pi as root.
- The checkout's git directory is moved out of the work tree into a root-owned mode-`0700` `GIT_DIR`
  under `RUNNER_TEMP`; the work tree contains no usable `.git`. The work tree is handed to the egress uid
  recursively except `node_modules/`, which stays read-only. The agent can edit and create source files
  but cannot reach hooks, config, objects, plant a replacement `.git`, or rewrite its own harness. A
  preflight probe runs as the egress uid and must succeed on a work-tree write, fail to read or write
  `GIT_DIR`, see no `.git` entry in the work tree, and fail to write under `node_modules/`. Ancestor
  directories of `GITHUB_WORKSPACE` get an execute bit for other users when needed, so the egress uid can
  traverse to the workspace without being able to list the runner's home.
- Git runs with `--git-dir=<GIT_DIR> --work-tree=<repoRoot>`, `-c safe.directory=<repoRoot>`, and
  `-c core.hooksPath=/dev/null`; commits also pass `--no-verify`. These are defense in depth: the git
  directory is already outside the agent's reach. The push credential moves from the
  `http.extraheader` command argument to `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_0` /
  `GIT_CONFIG_VALUE_0` in the git child's environment, whose `/proc/<pid>/environ` is not readable by
  the egress uid. The git config is asserted clean after the push, as before.
- The child gets an explicit `HOME`, `TMPDIR`, and `XDG_CACHE_HOME` under the chowned session directory,
  so Pi never needs `/home/agent-egress` (created with `--no-create-home`). `PATH` is passed only for
  the agent's own `bash` tool; it contains no Pi entry.
- Pi is spawned as a process-group leader and the whole group is killed at teardown **before** the diff
  is collected. The orchestrator then reaps any process still owned by the egress uid (`pkill -KILL -u`),
  so an agent-spawned process cannot keep editing the tree while the orchestrator commits, even if it
  called `setsid` to leave the group.

**Rejected alternatives**: running the orchestrator unprivileged and spawning a setuid helper (the
helper would be root-owned, so the unprivileged orchestrator could not signal it for `abort`); applying
egress to the runner uid and splitting GitHub access into a second job (breaks progress streaming and
halt); unprivileged user namespaces (not guaranteed on `ubuntu-24.04` and not a stable platform
contract); running Pi as the same uid as the orchestrator (the agent could read
`/proc/<orchestrator>/environ`, where the repository token lives).

### Job shape after the amendment

```text
checkout (persist-credentials: false)
setup-node 22.19
npm ci --ignore-scripts && npm run build
prepare                                  # unprivileged, outputs cache key + allow hosts
restore session cache
write mode-0600 env file                 # secrets for the orchestrator, read once and unlinked
sudo bash .github/scripts/agent-egress.sh  # creates agent-egress, applies uid policy
sudo --preserve-env=… "$(command -v node)" dist/src/agent/main.js run|command
  # orchestrator: move .git to root-owned GIT_DIR, chown work tree, preflight, then spawn Pi
save session cache
```

### Files touched by this amendment

| File | Change |
|------|--------|
| `src/agent/pi-runtime.ts` (new) | Resolve entry, package root, installed version; assert exact pin; build the child environment |
| `src/agent/config.ts` | Include the pinned Pi version in the configuration fingerprint (`computeFingerprint`) |
| `src/agent/pi-session.ts` | Take the resolved runtime instead of `pi`/`argPrefix`; spawn `nodePath + entry`; explicit `HOME`/`TMPDIR`; process-group teardown |
| `src/agent/main.ts` | Read and unlink the mode-`0600` env file before spawning; resolve and preflight the runtime before the acknowledgement; pass the version to `agent:ack`; assert uid 0 when an egress uid is set |
| `src/agent/workspace.ts` | Separate `GIT_DIR` outside the work tree, `--git-dir`/`--work-tree`, `safe.directory`, hooks disabled, credential via git environment; ensure ancestor traversal |
| `.github/workflows/agent-run.yml`, `agent-command.yml` | Run the Pi-spawning mode through `sudo --preserve-env` with an absolute Node path; write the mode-`0600` secret file and pass only its path and non-secret values through `sudo` |
| `.github/scripts/agent-egress.sh` | Publish the egress uid (already) and fail if the egress user cannot traverse the workspace |
| `.agent/README.md` | State that the Pi version is pinned by `package.json`/`package-lock.json`, is not editable in `.agent/config.yml`, and participates in the fingerprint |
| `tests/unit/pi-runtime.test.ts` (new) | Bare `PATH`, exact-version assertion, entry outside `node_modules`, missing entry |
| `tests/unit/egress-preflight.test.ts` (new) | Work-tree write allowed; `GIT_DIR`/`.git`/`node_modules` denied; uid check |
| `tests/unit/config.test.ts` | Fingerprint changes when the pinned Pi version changes |
| `tests/integration/pi-launch.test.ts` (new) | Spawn shape is `node + resolved entry`, never a bare `pi`; no GitHub token in the child |
| `tests/integration/workspace-git.test.ts` (new) | Separate `GIT_DIR`, hooks off, push credential in the git env |
| `tests/fake-github.ts` | Inject a stub runtime instead of `piCommand`/`argPrefix` |

### Acceptance for the amendment

| Check | Expected |
|-------|----------|
| No global `pi` and `PATH=/usr/bin:/bin` | The run still starts Pi from `node_modules/` (unit + integration test) |
| Entry resolves outside `<repoRoot>/node_modules` | Run fails with `environment` before any model call |
| Dependency is a range or installed version differs from the pin | Run fails with `environment`; `agent:ack` is not posted with a false version |
| Workflow run/command step | The Pi child has uid `AGENT_EGRESS_UID`; the orchestrator has uid 0; the provider key is inherited, the GitHub token is not; the secret file is gone before Pi starts |
| Egress uid reads or writes `GIT_DIR`, sees a `.git` entry in the work tree, or writes under `node_modules/` | Denied; preflight fails the run with `environment` |
| Egress uid edits an existing tracked file and creates a new one | Allowed |
| Agent-started background process | Killed with the process group, and any remaining process of the egress uid is reaped, before the diff is collected |
| Push | Token appears in no argv; the git config stays clean; `git` succeeds on the agent-owned work tree with the separate git directory |
| Pi pin changes | The configuration fingerprint and cache key change; no session written by the old version is resumed |

### Constitution check for the amendment

The amendment adds no non-English content and no new artifact class: it changes how an existing
English-documented component is provisioned and privileged. It strengthens, rather than relaxes, the
credential-separation guarantee that the main Constitution Check records as a pass. No deviation is
declared, so Complexity Tracking stays empty.

### Out of scope for this amendment

Full syscall/filesystem sandboxing (seccomp, PID or mount namespaces) and a container-based runner are
not introduced. The process-group teardown, the uid-wide reap, and the git-directory separation close
the concrete paths this feature opens; a general sandbox is a separate change.
