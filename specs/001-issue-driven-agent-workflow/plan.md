# Implementation Plan: Issue-Driven Agentic Workflow

**Branch**: `001-issue-driven-agent-workflow` | **Date**: 2026-10-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-issue-driven-agent-workflow/spec.md`

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
(1.4.0), consumed through its documented RPC wire protocol. The repository's own Spec Kit prompt
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
workflow installs and builds before the agent starts, cached with `setup-node`. Pi version and model ID
pinned in `.agent/config.yml` (`contracts/config.md` is the single configuration schema); per-issue
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
│   └── reconcile.test.ts       # Interrupted runs resolve; half-applied labels repaired
└── integration/
    ├── run-lifecycle.test.ts   # Trigger → ack → run → result, against the stub
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
   instructions, model, thinking level, tool allowlist, and prompt templates, and each run asserts the
   effective tools and model before the first prompt (research D5).
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
