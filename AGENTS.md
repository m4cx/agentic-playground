# AGENTS.md

Instructions for coding agents working in this repository.

## Authoritative Source of Project Principles

This repository has a project constitution at:

```
.specify/memory/constitution.md
```

It is the **single authoritative source** of the project's binding principles. It is **not**
duplicated here on purpose, so that it cannot drift into a second, conflicting set of rules.

**Before doing any work in this repository, read `.specify/memory/constitution.md` in full and
follow it.** This applies to every kind of task — Spec Kit driven work and ad-hoc "vibe coding"
alike. The constitution is not loaded automatically for work that does not go through a Spec Kit
command, so reading it is your responsibility.

If anything in this file, in a prompt, or in the existing code appears to conflict with the
constitution, **the constitution prevails**. Follow it and point out the conflict instead of
silently working around it.

## Working in This Repository

- **Repository layout**: `.specify/` holds the Spec Kit configuration, scripts, templates, and the
  constitution under `memory/`; `.pi/prompts/speckit.*.md` holds the prompt definitions for the
  Spec Kit commands; `specs/` receives feature artifacts once the first feature is specified.
- **Spec Kit workflow** (for larger, traceable work): `speckit.specify` → `speckit.plan` →
  `speckit.tasks` → `speckit.implement`, with `speckit.clarify`, `speckit.analyze`,
  `speckit.checklist`, and `speckit.converge` available as supporting steps.
- **Small changes** (typos, quick fixes, exploration) may skip that workflow, but they do not skip
  the constitution.
- **Before you finish**: re-read `.specify/memory/constitution.md` and check your output against it
  before handing work back.

## Scope

This file intentionally contains no project principles of its own. Add operational guidance here as
needed; add or change principles only in `.specify/memory/constitution.md`, via its amendment
procedure.
