<!--
Sync Impact Report
==================
Version change: 1.0.0 → 1.1.0
Bump rationale: MINOR. A new principle (II. Root README Reflects Current Project State) is added and
its guidance is expanded in Additional Constraints and Development Workflow. No existing principle is
removed or redefined, so the change is backward-compatible.

Modified principles:
  - I. English as the Standard Language (unchanged; Principle II inherits its English rule)
  - II. Root README Reflects Current Project State (new)

Added sections:
  - None (no new top-level sections)

Expanded sections:
  - Additional Constraints: definition of "current project state" for the root README
  - Development Workflow: same-change README update gate

Removed sections:
  - None

Deferred TODOs:
  - TODO(RATIFICATION_DATE_BASIS): Ratification date remains set to the date the Spec Kit scaffold
    was committed (2026-10-26). Confirm this is the intended adoption date.
  - Principle II is enforced by review only; no automated README freshness check exists yet. If one is
    desired, it requires a separate specification.

Notes for reviewers: This report is temporary scratch material and MUST be removed before the
amended constitution is committed.
-->

# Agentic Playground Constitution

## Core Principles

### I. English as the Standard Language

English is the standard language of this project. This is a non-negotiable rule for everything the
project produces, not just for prose:

- All documents MUST be written in English: README files, specification, plan, task, research and
  checklist artifacts, architecture and design notes, runbooks, and inline documentation.
- All source code MUST be written in English: identifiers (variables, functions, types, modules,
  files and directories), comments, docstrings, log and error messages, and user-facing strings
  unless a specific localization requirement states otherwise.
- All machine-readable and collaborative artifacts MUST be in English: commit messages, branch and
  tag names, pull request and review descriptions, issue text, configuration and schema field
  names, and test names and descriptions.

Communication MAY take place in other languages. Chat conversations, review discussions, meetings,
and informal notes exchanged between contributors are explicitly out of scope of this rule; the
language of discussion does not change the language of the resulting artifacts.

Rationale: A single artifact language keeps the repository searchable, reviewable, and accessible to
contributors and to the agents operating in this repository, and avoids mixed-language drift where
identifiers, docs, and specs describe the same concept with different words. Restricting the rule to
artifacts rather than conversations preserves contributors' freedom to think and discuss in their
preferred language.

### II. Root README Reflects Current Project State

The `README.md` in the repository root is the primary entry point to the project and MUST always
reflect the current, actual state of the project. It is normative documentation, not a historical
snapshot:

- The root `README.md` MUST be updated in the same change that alters the project state it
  describes. Deferring the update to a later change is a violation, not a follow-up task.
- It MUST accurately describe at minimum: the project's purpose, what currently works and what does
  not, prerequisites and setup steps, how to run and verify the project, and the repository structure
  contributors need to navigate.
- It MUST NOT describe planned, removed, or aspirational functionality as if it were available, and
  MUST NOT retain instructions that no longer work.
- Any change that adds, removes, renames, or reconfigures a user-visible capability, command, tool,
  dependency, or top-level directory MUST include the corresponding README update.
- The root `README.md` MUST be written in English, consistent with Principle I.

Rationale: A stale README is worse than none, because contributors and agents trust it and then act
on wrong assumptions about how to build and run the project. Tying the update to the same change that
alters the project state keeps the README verifiable at review time, when the author still has full
context, instead of relying on discipline that decays.

## Additional Constraints

**Definition of "current project state"**: For Principle II, the current project state covers every
artifact the repository ships or documents: implemented capabilities and their status, tooling and
workflow setup, required dependencies and versions, entry-point commands, and the top-level directory
layout. Internal implementation detail that the README does not claim to cover is out of scope; any
statement the README does make MUST be true at merge time.

**Scope of "documents and source code"**: This constitution governs artifacts that are created,
generated, or modified as part of the project's engineering lifecycle. It applies equally to content
produced by humans and by agents, including generated specifications, plans, tasks, code, tests, and
commit messages.

**Exception handling**: Localization assets (translation catalogs, localized user-facing resources)
and verbatim quotations of external sources MAY contain other languages. Each exception MUST be
required by an explicit feature requirement or external constraint; incidental non-English content
is a violation, not an exception.

## Development Workflow

- Every review of a change MUST verify the language standard for the artifacts it touches; a change
  with non-English artifact content is not compliant and MUST be corrected before merge.
- Agents operating in this repository MUST apply the standard to everything they write to disk, and
  MUST NOT introduce non-English identifiers or documentation as a side effect of a task.
- Every review MUST verify that the root `README.md` is still accurate for the change under review;
  an outdated root `README.md` blocks merge until corrected in the same change (Principle II).
- When a task requires a language other than English in an artifact, the deviation MUST be declared
  and justified in the specification or plan before implementation.

## Governance

**Amendment procedure**: Amendments are proposed as a change to this file, must state the version
bump and its rationale, and require review and approval by the project maintainer before merge. Any
amendment that redefines or removes a principle MUST include a migration note describing how
existing artifacts will be brought into compliance.

**Versioning policy**: This constitution follows semantic versioning.
- MAJOR: backward-incompatible governance changes, including removal or redefinition of a principle.
- MINOR: a new principle or section, or materially expanded guidance.
- PATCH: clarifications, wording fixes, and other non-semantic refinements.

**Compliance review expectations**: All pull requests and reviews MUST verify compliance with the
principles of this constitution, including the accuracy of the root `README.md`. Complexity or deviation that cannot be justified against a principle
MUST be rejected rather than silently accepted. Identified non-compliance is tracked and resolved as
part of the same change whenever feasible; otherwise it MUST be recorded as a follow-up before merge.

**Version**: 1.1.0 | **Ratified**: 2026-10-26 | **Last Amended**: 2026-10-26
