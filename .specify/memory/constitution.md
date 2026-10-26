<!--
Sync Impact Report
==================
Version change: 0.0.0 (unratified scaffold) → 1.0.0
Bump rationale: First ratified constitution. The scaffold contained only placeholders, so this is an
initial adoption (MAJOR-equivalent) rather than an amendment to existing governance.

Modified principles:
  - [PRINCIPLE_1_NAME] → I. English as the Standard Language (new, ratified)
  - [PRINCIPLE_2_NAME] → removed (never ratified; no project requirement justified it)
  - [PRINCIPLE_3_NAME] → removed (never ratified)
  - [PRINCIPLE_4_NAME] → removed (never ratified)
  - [PRINCIPLE_5_NAME] → removed (never ratified)

Added sections:
  - Additional Constraints (document and code artifact scope of the language standard)
  - Development Workflow (compliance review for generated artifacts)
  - Governance (amendment procedure, versioning policy, compliance review expectations)

Removed sections:
  - None (all template sections existed only as placeholder slots)

Deferred TODOs:
  - TODO(RATIFICATION_DATE_BASIS): Ratification date is set to the date the Spec Kit scaffold was
    committed (2026-10-26). Confirm this is the intended adoption date; adjust if the project was
    formally adopted on a different date.
  - Additional principles are intentionally deferred until the project defines further
    non-negotiable rules (e.g., testing, architecture, tooling). Add them via the amendment
    procedure rather than pre-emptively.

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

## Additional Constraints

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
principles of this constitution. Complexity or deviation that cannot be justified against a principle
MUST be rejected rather than silently accepted. Identified non-compliance is tracked and resolved as
part of the same change whenever feasible; otherwise it MUST be recorded as a follow-up before merge.

**Version**: 1.0.0 | **Ratified**: 2026-10-26 | **Last Amended**: 2026-10-26
