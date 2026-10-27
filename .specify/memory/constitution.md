# Agentic Playground Constitution

## Core Principles

### I. English for All Generated Content

Every piece of content generated for this project MUST be written in English. This holds regardless
of the language used to discuss the work.

- All generated documents MUST be in English: README files, specification, plan, task, research and
  checklist artifacts, design and architecture notes, runbooks, and inline documentation.
- All generated code and code-adjacent content MUST be in English: identifiers (variables,
  functions, types, modules, file and directory names), comments, docstrings, log and error
  messages, and user-facing strings unless a specific localization requirement states otherwise.
- All generated collaborative and machine-readable artifacts MUST be in English: commit messages,
  branch and tag names, pull request descriptions, test names and descriptions, configuration keys,
  and schema field names.
- Communication and inbound content MAY be in another language. Chat conversations, review
  discussions, meetings, and issue threads may be written in any language; a response inside such a
  thread MAY use that thread's language. The language of the conversation MUST NOT change the
  language of any artifact produced from it.
- Every artifact derived from a non-English discussion — specification text, commit message,
  documentation, code comment, summary — MUST be written in English.

Rationale: A single artifact language keeps the repository searchable, reviewable, and unambiguous
for every contributor and every agent, and prevents the same concept from being named differently in
different languages across specs, code, and documentation. Limiting the rule to generated content
rather than to people's conversations keeps contributors free to think, discuss, and report issues
in whatever language they are most precise in, without leaking that choice into the project record.

## Additional Constraints

**Scope of "generated content"**: This principle governs artifacts produced by humans or agents as
part of the project's engineering work: files written to the repository, content that becomes part
of the project record, and text produced on the project's behalf. It applies to generated output
only, not to the language in which contributors choose to communicate.

**Inbound content in other languages**: External input such as issue reports, user feedback,
third-party documentation, and verbatim quotations MAY be in any language and MUST NOT be rewritten
solely to satisfy this principle. Any content produced in response and committed or published as a
project artifact MUST be in English.

**Exceptions**: Localization assets (translation catalogs, localized user-facing resources) and
verbatim quotations of external sources MAY contain other languages. Each exception MUST be required
by an explicit feature requirement or external constraint; incidental non-English content is a
violation, not an exception.

## Development Workflow

- Every review of a change MUST verify the language standard for the artifacts it touches; a change
  containing non-English generated content is not compliant and MUST be corrected before merge.
- Agents operating in this repository MUST apply the standard to everything they write, including
  summaries, commit messages, and follow-up notes, and MUST NOT mirror the language of the prompt
  into repository artifacts.
- When a feature genuinely requires non-English content in an artifact, the deviation MUST be
  declared and justified in the specification or plan before implementation.

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
principles of this constitution. Deviation that cannot be justified against a principle MUST be
rejected rather than silently accepted. Identified non-compliance is tracked and resolved as part of
the same change whenever feasible; otherwise it MUST be recorded as a follow-up before merge.

**Version**: 2.0.1 | **Ratified**: 2026-10-26 | **Last Amended**: 2026-10-26
