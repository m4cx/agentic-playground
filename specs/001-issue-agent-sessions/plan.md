# Implementation Plan: Issue-Driven Agent Sessions

**Branch**: `001-issue-agent-sessions` | **Date**: 2026-10-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-issue-agent-sessions/spec.md`

## Summary

Turn a labeled GitHub issue into one long-lived coding-agent session. A GitHub Actions job reads the
issue, drives the Pi coding agent over its RPC protocol, and writes the agent's work as commits on
`feature/{issue-id}-{issue-slug}`. The orchestrator — never the agent — holds the repository token,
pushes the branch, opens or updates a pull request, and posts English summaries and state updates in
the issue thread. A human merges; the agent never does. Follow-up work is resumed only by an explicit
signal, reuses the same session and branch, and merges the current default branch first. Agent egress
is denied by default and limited to the model provider and declared package registries.

The issue thread is the authoritative record: a single bot-owned state comment carries a
machine-readable marker, and append-only result comments tell the story. Pi session files are a
best-effort continuity cache; when the cache is gone, the orchestrator rebuilds context from the
thread and the branch.

## Technical Context

**Language/Version**: TypeScript 5.7 on Node.js 22.19+, ESM, `strict` mode, compiled with `tsc` to
`dist/` (no bundler, no runtime transpiler). Workflow definitions in GitHub Actions YAML; agent
behaviour in Markdown instructions.

**Primary Dependencies**: `@earendil-works/pi-coding-agent` pinned to `1.4.0`, consumed through its
documented RPC protocol and the exported `RpcClient`. GitHub access uses the Node built-in `fetch`.
Tests use `node:test`. Development dependencies are `typescript` and `@types/node` only.

**Storage**: No database. The issue thread is the authoritative session record: one bot comment holds
a versioned JSON marker (session identity, slug, branch, state, PR number, request hash, trigger
history), and result comments are append-only evidence. The branch and pull request live in Git and
GitHub. Pi session files are cached with `actions/cache` keyed by issue and configuration fingerprint;
the thread digest is the fallback when the cache is missing.

**Testing**: `node:test` unit tests for config validation, slug and branch derivation, state-marker
round-trips and transitions, trigger parsing, permission gating, redaction, and message rendering. An
in-memory fake GitHub client and a scripted fake RPC peer cover the orchestrator lifecycle:
label → acknowledge → commit → PR → result, resume → merge default → update branch, failure → failed
state, unauthorized actor → no work, and merge/close outcome. Contract tests assert that the workflow
filters and `.agent/config.json` agree on the trigger label and resume command.

**Target Platform**: GitHub-hosted ephemeral Ubuntu 24.04 runner. Triggers: `issues: labeled`,
`issue_comment: created`, `pull_request: closed`, `issues: closed`, plus `push`/`pull_request` for the
project's own CI. Nothing runs on a contributor machine.

**Project Type**: Single project — a CI-hosted agent service (workflows + TypeScript orchestrator)
that lives inside the repository it operates on.

**Performance Goals**: Acknowledgement comment posted within 2 minutes of the job starting; a small
request reaches a result comment and branch within 15 minutes (SC-001); at most one agent session
active per issue at any time (SC-003).

**Constraints**: TypeScript `strict` with `noUncheckedIndexedAccess`; `dist/` is build output and is
never committed; the agent process receives no GitHub token, no repository write credential, and no
provider key beyond the model endpoint credential it needs; default-deny egress for the agent UID
with an explicit allowlist (FR-026); no force-push, no direct commits to the default branch, no
automatic retries (FR-010, FR-017); job timeout 60 minutes with a 45-minute agent deadline; all
agent-authored artifacts in English (constitution, FR-021).

**Scale/Scope**: One repository, tens of handled issues per month. Per-issue serialization is
sufficient; no global concurrency cap is introduced. Issue threads are read up to a bounded number of
comments, with truncation marked explicitly in the prompt.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution version in force: **2.0.1**. Applicable principle: **I. English for All Generated
Content**, plus the Additional Constraints (scope of generated content, inbound content in other
languages) and the Development Workflow (review must verify the language standard).

| Gate | Assessment | Result |
|------|------------|--------|
| Generated artifacts in English (code, comments, commit messages, PR text, branch names, docs, config keys) | FR-021 makes this a functional requirement. `.agent/instructions.md` restates it for the model; the orchestrator renders every durable thread message from English templates it owns; commit and PR templates are fixed English strings; the agent's structured output is validated before it becomes a record. | PASS |
| Inbound non-English content preserved, not translated into the record | Issue title, body, and comments may be in any language and are passed to the agent as data. The orchestrator does not translate them and does not quote them into generated English prose beyond the issue link. | PASS |
| Branch-name language | The slug is a mechanical, ASCII-normalized derivative of the inbound issue title and is treated as a verbatim identifier, not generated prose. If normalization leaves no ASCII letters or digits, the slug falls back to `issue`, which is English. All other branch-name components are fixed English strings. | PASS |
| Deviation protocol (declare non-English content in spec/plan before implementation) | Not needed: no non-English artifact is produced by the implementation. | PASS |
| Review verification of the language standard | `quickstart.md` includes a language-conformance check for every handled issue; `tasks.md` will carry it as an explicit verification step. | PASS |

No violations; **Complexity Tracking is empty**.

## Project Structure

### Documentation (this feature)

```text
specs/001-issue-agent-sessions/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── triggers.md      # Workflow event filters, trigger semantics, permissions
│   ├── session-state.md # Session identity, state marker, transitions, idempotency
│   ├── branch-and-pr.md # Branch naming, commits, push, pull request contract
│   ├── agent-io.md      # Prompt envelope and structured agent output
│   ├── config.md        # Single schema for .agent/config.json
│   └── pi-rpc.md        # Orchestrator ↔ Pi RPC subset, session cache, timeouts, egress
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit.tasks — not created here)
```

### Source Code (repository root)

```text
package.json                  # ESM, engines >=22.19, scripts: build, typecheck, test
package-lock.json             # exact dependency graph, including Pi 1.4.0
tsconfig.json                 # strict, module nodenext, rootDir ., outDir dist
.gitignore                    # add .agent-state/ for the run-local session cache
.github/
├── workflows/
│   ├── agent-run.yml         # issues: labeled → start or resume a session
│   ├── agent-resume.yml      # issue_comment: created → explicit resume signal
│   ├── agent-review.yml      # pull_request/issue closed → record outcome
│   └── ci.yml                # typecheck, tests, and workflow/config contract check
└── scripts/
    └── agent-egress.sh       # default-deny allowlist for the agent UID (FR-026)

.agent/
├── config.json               # Trigger label, resume command, model, tools, egress allowlist
├── models.json               # Pi provider endpoint and model definition
├── instructions.md           # Standing instructions appended to Pi's system prompt
└── README.md                 # How a maintainer changes agent behaviour

src/agent/
├── main.ts                   # Entry point: dispatch run, resume, or review mode
├── config.ts                 # Load, validate, and fingerprint .agent/config.json
├── events.ts                 # GitHub event payload → Trigger or ReviewOutcome
├── github.ts                 # Thin REST client over global fetch
├── permissions.ts            # Effective write-access check
├── trigger.ts                # Label and resume-command parsing, bot/PR-comment filters
├── slug.ts                   # ASCII-normalized issue slug derivation
├── state.ts                  # State marker parse/render, transitions, idempotency
├── thread.ts                 # Thread reading, context digest, idempotent comments
├── session.ts                # Session lifecycle orchestration
├── workspace.ts              # Clone, checkout, default-branch merge, diff, commit, push
├── pi.ts                     # Pi RPC lifecycle: start, prompt, observe, deadline
├── pi-runtime.ts             # Resolve pinned Pi binary and build the unprivileged environment
├── pr.ts                     # Pull request create/update and link rendering
├── review.ts                 # Merge/close outcome handling
├── output.ts                 # Structured agent output parsing and validation
├── messages.ts               # English thread message templates
└── redact.ts                 # Secret and credential redaction before posting

tests/
├── fake-github.ts            # In-memory GitHub client used by integration tests
├── fake-rpc.ts               # Scripted Pi RPC peer used by integration tests
├── unit/
│   ├── config.test.ts
│   ├── slug.test.ts
│   ├── state.test.ts
│   ├── trigger.test.ts
│   ├── permissions.test.ts
│   ├── messages.test.ts
│   ├── redact.test.ts
│   ├── output.test.ts
│   ├── review.test.ts
│   ├── thread.test.ts
│   ├── pi-runtime.test.ts
│   └── language.test.ts
├── integration/
│   ├── run.test.ts
│   ├── resume.test.ts
│   ├── review.test.ts
│   └── failure.test.ts
├── contract/
│   ├── workflow-config.test.ts
│   └── schema.test.ts
└── fixtures/
    ├── events/
    └── rpc/
```

**Structure Decision**: Single project at the repository root. The orchestrator is a small Node CLI
that runs inside the workflow, so it shares the repository's existing `tsconfig.json` and `src/`/`tests/`
layout. Workflows stay thin: they install, build, apply the egress policy, and invoke one orchestrator
entry point. All behaviour that can be unit-tested lives in `src/agent/`, not in YAML.

## Design Overview

### Runtime and privilege split

1. A GitHub Actions job starts on `ubuntu-24.04` with `permissions: contents: write, issues: write,
   pull-requests: write`.
2. The orchestrator runs as the runner user and owns `GITHUB_TOKEN` and the provider key.
3. It materializes the reviewed behaviour files (`instructions.md`, `config.json`, `models.json`) from
the current default-branch commit into a run-local directory, clones the repository into a workspace
owned by a dedicated unprivileged `agent-egress` user, applies the egress allowlist scoped to that
UID, and starts Pi as that user over RPC.
4. Pi edits files and runs builds/tests. It has no GitHub token and no network route except the
   model provider and declared package registries.
5. After Pi settles, the orchestrator validates the agent output, commits the changes, pushes the
   feature branch, opens or updates the pull request, and posts the result comment.

### Session identity and state

- Session ID: `issue-<issue-number>`; the slug is fixed on first run and stored in the state marker.
- Branch: `feature/<issue-number>-<slug>`.
- State marker: one bot comment per issue with a versioned JSON payload in an HTML comment. It is
  updated in place and is the first thing every job reads.
- Result comments: append-only, English, one per run, with a hidden run marker for idempotency.
- Concurrency: workflow `concurrency` group per issue with `cancel-in-progress: false`; the state
  marker is re-read at the start of every run and transitions are validated before any side effect.

### Agent input and output

- Input: a fixed English system instruction plus a JSON-enveloped task containing the issue title,
  body, relevant comments, prior agent summaries, session state, branch status, and any unresolved
  merge conflicts. Issue content is clearly delimited as data.
- Output: the agent must finish with a fenced JSON object (`summary`, `verification`,
  `openQuestions`, `couldNotComplete`, `prTitle`, `prBody`, `state`). The orchestrator parses the last
  valid block, redacts it, and renders the thread summary. Missing output is a failed run with a
  clear reason, not a silent success.
- The orchestrator never posts raw model prose as a durable record; it renders deterministic English
  templates around validated fields.

### Failure and resume

- No automatic retry at either layer. Pi's automatic retry is disabled; a retry signal aborts the run
  and fails it.
- A failed, stopped, or waiting session is resumed only by the explicit resume signal. Ordinary
  comments are ignored.
- On resume, the orchestrator checks out the existing branch, merges the current default branch, and
  passes unresolved conflicts to the agent. If the agent cannot resolve them, the run fails with the
  conflicting paths in the thread.
- If the Pi session cache is missing, the orchestrator reconstructs context from the thread digest and
  the branch diff instead of pretending the prior conversation is available.

## Phase 0: Research

See [research.md](./research.md). All Technical Context unknowns are resolved there: runtime, Pi
integration, privilege split, state continuity, branch/PR lifecycle, retries, egress, and testing.

## Phase 1: Design & Contracts

- [data-model.md](./data-model.md): entities, fields, validation rules, and state transitions.
- [contracts/triggers.md](./contracts/triggers.md): event filters, permission checks, trigger parsing.
- [contracts/session-state.md](./contracts/session-state.md): marker schema and transition table.
- [contracts/branch-and-pr.md](./contracts/branch-and-pr.md): branch naming, commits, push, PR rules.
- [contracts/agent-io.md](./contracts/agent-io.md): prompt envelope and structured output schema.
- [contracts/config.md](./contracts/config.md): `.agent/config.json` schema and validation.
- [contracts/pi-rpc.md](./contracts/pi-rpc.md): RPC subset, session cache, deadlines, egress policy.
- [quickstart.md](./quickstart.md): setup, manual validation scenarios, and expected outcomes.

## Post-Design Constitution Check

Re-evaluated after Phase 1. The design keeps every durable artifact English; issue content is passed
as data and never translated into the record; commit, PR, and thread text come from English templates;
branch names use fixed English prefixes and an ASCII-normalized title slug with an English fallback.
No new violations. **Complexity Tracking remains empty.**

## Complexity Tracking

No constitution violations to justify.
