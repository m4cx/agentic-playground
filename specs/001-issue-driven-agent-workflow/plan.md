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

**Language/Version**: Node.js 22.19+ (ESM, no build step, JSDoc type annotations checked with
`tsc --noEmit`); workflow definitions in GitHub Actions YAML; agent behaviour in Markdown
instructions.

**Primary Dependencies**: `@earendil-works/pi-coding-agent` pinned to the exact version used locally
(1.4.0), consumed through its documented RPC wire protocol. No other runtime dependencies: GitHub
access uses the Node built-in `fetch`, tests use `node:test`.

**Storage**: No database. Authoritative state lives in the repository: issue labels carry the run
state, issue comments carry the audit record and agent feedback, pull requests carry proposed
changes. A per-issue Pi session file is cached between runs as a best-effort continuity aid and is
never authoritative.

**Testing**: `node:test` unit tests for command parsing, permission gating, state transitions,
budget accounting, redaction, and proposal payloads; a stub RPC peer (JSONL over stdio) for
orchestrator tests that need a Pi-shaped event stream; scripted end-to-end scenarios in
`quickstart.md` against a sandbox repository.

**Target Platform**: GitHub-hosted ephemeral Ubuntu runner (`ubuntu-24.04`), triggered by
`issues`, `issue_comment`, and `pull_request_review` events. Nothing runs on a contributor machine.

**Project Type**: Single project — a CI-hosted agent service (workflow definitions + orchestrator)
that lives inside the repository it operates on.

**Performance Goals**: acknowledgement comment within 2 minutes of a trigger (SC-002); halt honoured
within 5 minutes (SC-009); small request end to end within 10 minutes (SC-001); one run per issue at a
time (FR-013).

**Constraints**: Pi version and model ID pinned; per-issue consumption limit with a soft warning and
a hard stop (FR-017); hard job timeout well below the platform's 6-hour ceiling; the orchestrator
alone holds `issues: write`, `contents: write`, and `pull_requests: write`; Pi never receives a
repository credential; all agent-authored content in English (constitution, FR-019).

**Scale/Scope**: One repository, tens of handled issues per month, serialized per issue; a
repository-wide concurrency cap of 2 concurrent agent jobs.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution version in force: **2.0.0**. Applicable principle: **I. English for All Generated
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
│   └── pi-rpc.md        # Orchestrator ↔ Pi RPC usage subset
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit.tasks — not created here)
```

### Source Code (repository root)

```text
.github/
└── workflows/
    ├── agent-run.yml        # issues: opened/labeled → start a run
    └── agent-command.yml    # issue_comment → halt/retry/continue/approve

.agent/
├── instructions.md          # Standing instructions appended to Pi's system prompt
├── config.yml               # Model, consumption limits, timeouts, label names, concurrency cap
└── README.md                # How a maintainer changes agent behaviour

src/agent/
├── main.js                  # Entry point: event → dispatch (run or command)
├── events.js                # GitHub event payload → Trigger or command input
├── config.js                # Load and validate .agent/config.yml
├── permissions.js           # Write-access gate and re-check at decision time
├── labels.js                # Label state machine (transitions, invariants)
├── commands.js              # Command-word parsing and validation
├── thread.js                # Thread reading, message markers, idempotent posting
├── messages.js              # English message templates (ack, status, feedback, result, failure)
├── budget.js                # Consumption accounting, soft warning, hard stop
├── pi-session.js            # Pi RPC lifecycle: start, prompt, observe, abort at boundary
├── halt-watch.js            # Polls the thread for commands while a run is active
├── workspace.js             # Repo state, branch creation, diff collection, commit
├── proposal.js              # Pull request creation and linkage
├── redact.js                # Secret/credential redaction before posting or committing
└── github.js                # Thin REST client over global fetch

tests/
├── fixtures/
│   ├── events/              # Captured GitHub event payloads
│   └── rpc/                 # Recorded Pi RPC event streams
├── stub-pi.js               # Fake Pi RPC peer for orchestrator tests
├── unit/
│   ├── commands.test.js
│   ├── permissions.test.js
│   ├── labels.test.js
│   ├── budget.test.js
│   ├── messages.test.js
│   ├── redact.test.js
│   └── proposal.test.js
└── integration/
    ├── run-lifecycle.test.js   # Trigger → ack → run → result, against the stub
    ├── halt-boundary.test.js   # Halt honoured at the next action boundary
    └── budget-stop.test.js     # Limit reached → stop → explicit decision required
```

**Structure Decision**: Single project. The repository currently holds only Spec Kit configuration,
prompts, and specifications, so this feature introduces the first executable code. It is kept in one
flat `src/agent/` module set rather than layered directories because every module is a single-purpose
piece of one process, and a deep tree would add navigation cost without adding a boundary. The
workflow YAML stays in `.github/workflows/` (platform requirement) and agent behaviour stays in
`.agent/` (reviewable content, not code).

## Design Decisions Carried From Research

Full rationale and rejected alternatives are in [research.md](./research.md).

1. **Runtime**: Pi in RPC mode, driven from Node over its documented JSONL protocol.
2. **Credential separation**: the orchestrator holds the repository token; Pi holds only the model
   provider key and filesystem tools. No repository authority inside the agent process.
3. **Configuration surface**: Pi runs with trust-gated project resources disabled and an explicit
   instruction file and tool allowlist, so behaviour does not depend on whatever `.pi/` content a
   branch happens to contain.
4. **State**: labels for state, comments for record, pull requests for proposals; platform
   concurrency groups for per-issue serialization.
5. **Budget**: measured from Pi's own session statistics each turn, with a soft threshold and a hard
   stop that requires an explicit command to continue.
6. **No automatic retry**: Pi's own transient-error retry is disabled to keep the spec's rule
   literally true and consumption predictable.

## Complexity Tracking

> No constitution violations, so no entries. The table below is intentionally absent rather than
> filled with justifications for choices that are not violations.
