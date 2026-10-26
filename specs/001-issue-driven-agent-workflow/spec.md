# Feature Specification: Issue-Driven Agentic Workflow

**Feature Branch**: `001-issue-driven-agent-workflow`

**Created**: 2026-10-26

**Status**: Draft

**Input**: User description: "ich möchte einen agentischen Workflow bauen, dieser soll nicht in auf der lokalen Maschine laufen. Das Kommunikationsinterface ist nicht das Terminal sondern lediglich das aktuelle GitHub Repository mit Issues."

## Clarifications

### Session 2026-10-26

- Q: Which people have the right to start, halt, and approve agent work in the repository? → A: People with write (push) access and above may start, halt, and approve.
- Q: How does a person signal that agent work should start, and how are later decisions such as halt, retry, or continue expressed? → A: A repository label starts work; halt, retry, continue, and approve are fixed command words. Commands take effect at the next action boundary instead of interrupting an action in flight, and the agent reports feedback before work is reported as halted.
- Q: Should the agent be expected to resist instructions hidden inside issue content, or is every permitted author fully trusted? → A: Issue content is treated as data, not as instructions: embedded directives that exceed the stated request or try to bypass approval, cost limits, or secret handling are ignored and reported in the thread.
- Q: Where must the durable record of a run live — only in the issue thread, or also as files committed into the repository? → A: The issue thread is the durable record; artifacts the work produces (proposal, files) are its evidence, and no separate run-record files are committed.
- Q: When a run fails partway through, should the system try again on its own? → A: No automatic retry; a run that fails ends in the failed state, and only an explicit retry command from a permitted person starts another attempt.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Request agent work from an issue and receive the result in the same thread (Priority: P1)

A requester opens an issue in the repository describing a task (for example a bug to fix, a document to draft, or a question about the codebase). Without installing anything or using a terminal, the requester signals that the agent should work on this issue. The agent picks the issue up, performs the work, and reports its result back as a reply in the issue thread, so the entire exchange is readable in the repository.

**Why this priority**: This is the core value of the feature. Everything else (approval, progress reporting, configuration) only makes sense once a requester can hand a task to the agent and read the outcome in the issue thread. Delivered alone, it already replaces the local terminal session completely.

**Independent Test**: Open a new issue with a small, self-contained request, mark it for agent handling, and confirm that the agent's answer appears as a comment in that issue without any local execution taking place.

**Acceptance Scenarios**:

1. **Given** an open issue that is marked for agent handling, **When** the requester submits it, **Then** the issue receives an acknowledgement comment stating that the work was accepted and is being processed.
2. **Given** an issue that the agent has finished processing, **When** the requester opens the issue, **Then** a comment from the agent states the outcome, the actions taken, and links to every artifact it produced.
3. **Given** an issue that is not marked for agent handling, **When** anyone comments on it, **Then** the agent does not start work and does not consume any capacity.
4. **Given** an issue handled by the agent, **When** the requester reads the thread, **Then** no step of the work requires the requester to run anything on their own machine.

---

### User Story 2 - Review and approve the agent's proposed changes before they take effect (Priority: P2)

When the agent's work results in changes to repository content, those changes arrive as a reviewable proposal that is linked from the issue. A maintainer reviews the proposal in the repository, approves or rejects it, and only approved changes become part of the main line. The agent never lands changes on its own.

**Why this priority**: Giving an autonomous agent write influence without a human gate is unacceptable for the repository's integrity. This story makes the feature safe to enable, and it is the second thing a maintainer will ask for after the first demo.

**Independent Test**: Request a change through an issue, verify that a reviewable proposal appears and is linked in the thread, verify that no change is applied while it is unreviewed, and verify that it takes effect only after an explicit approval.

**Acceptance Scenarios**:

1. **Given** an issue whose work produces content changes, **When** the agent finishes, **Then** the issue thread contains a link to a reviewable proposal containing exactly the changes the agent made.
2. **Given** an unreviewed proposal produced by the agent, **When** nobody has approved it, **Then** the main line of the repository remains unchanged.
3. **Given** a rejected proposal, **When** the rejection is recorded, **Then** the agent does not retry the same changes unless a human explicitly asks for another attempt, and the rejection reason is captured in the issue thread.
4. **Given** an approved proposal, **When** it is accepted, **Then** the issue thread records who approved it and at what point in time.

---

### User Story 3 - Follow progress of long-running work from the issue (Priority: P3)

A requester returns to an issue hours later and wants to know what happened. The issue thread shows the current state of the work: accepted, in progress, waiting for a decision, finished, failed, halted, or rejected.

**Why this priority**: The workflow is asynchronous and unattended. Without visible state, requesters cannot distinguish "still working" from "silently died", which destroys trust in the workflow. It is a smaller increment than the first two stories and can follow them.

**Independent Test**: Start work on an issue, observe that the thread's state indicator changes over time and ends in a terminal state, and confirm that no state is left ambiguous.

**Acceptance Scenarios**:

1. **Given** work in progress on an issue, **When** the requester checks the issue, **Then** the current state is visible without asking a follow-up question.
2. **Given** work that has ended, **When** the requester checks the issue, **Then** the state is one of the terminal states (finished, failed, or rejected) and never remains in progress.
3. **Given** work that failed, **When** the requester reads the issue, **Then** the failure reason and whether a retry is sensible are stated in plain language.

---

### User Story 4 - Control the agent's behaviour from repository content (Priority: P3)

A maintainer adjusts how the agent behaves — what it is allowed to do, which conventions it follows, how much it may spend — by editing content in the repository, without touching any infrastructure or terminal.

**Why this priority**: The repository is the only interface, so configuration must also live there. It is not needed for the first usable version but is required before the workflow scales beyond a single trusted user.

**Independent Test**: Change a documented instruction in the repository, trigger new work, and confirm that the agent's behaviour follows the changed instruction.

**Acceptance Scenarios**:

1. **Given** documented standing instructions for the agent in the repository, **When** new work starts, **Then** the agent follows the currently committed version of those instructions.
2. **Given** a changed instruction, **When** it is committed, **Then** subsequent work uses the new version and earlier work remains unchanged.
3. **Given** an instruction the agent cannot honour, **When** work starts, **Then** the issue thread states that the instruction was not followed and why, instead of failing silently.

---

### User Story 5 - Pause or stop the agent from the issue thread (Priority: P3)

A maintainer who notices unwanted behaviour can halt the agent using only the issue thread, and the halt takes effect promptly for that issue and, if requested, for all future work.

**Why this priority**: An unattended agent needs an emergency brake that is reachable through the sole interface. It is a safety requirement rather than a feature of daily use, so it ranks below getting the workflow running.

**Independent Test**: Request a halt in an issue where work is running, and confirm that no further action starts, that the agent reports what it completed and left undone, and that the halt is visible in the thread.

**Acceptance Scenarios**:

1. **Given** work running on an issue, **When** a permitted person posts a halt command in that thread, **Then** no further action starts, the agent posts feedback describing what it completed and what it left undone, and only then is the issue reported as halted.
2. **Given** a halt command posted while an action is already in flight, **When** that action finishes, **Then** the agent stops before starting another action and reports, so that no finished work is lost or silently discarded.
3. **Given** a global halt request, **When** it is recorded, **Then** no new work starts until it is lifted, and the blocking state is visible in the issue where it was requested.
4. **Given** a halted issue, **When** work is requested again after the halt is lifted, **Then** the new work starts from the recorded state of the issue instead of repeating finished steps blindly.
5. **Given** a person who does not have write access, or who lost it after starting work, **When** they post any command in the thread, **Then** the command is ignored and the thread states that write access is required.

---

### Edge Cases

- **Issue edited or closed while work is running**: the agent must not continue against outdated instructions; it stops or restates which version of the request it is serving.
- **Duplicate or repeated trigger**: the same issue must not start two concurrent runs, and repeated signals on a running issue must not multiply consumption.
- **Contradictory requests in one thread**: the agent states which interpretation it chose and why, instead of silently picking one.
- **Request too large or too vague for a single run**: the agent states what it needs and returns the work to the requester instead of producing speculative changes.
- **Requester without the right to start work**: the signal is ignored and the thread explains the requirement.
- **Agent run interrupted mid-way**: the issue does not remain in progress forever; the interrupted run is reported as failed with the reason, and no automatic attempt follows.
- **Command arrives while an action is already in flight**: the in-flight action is allowed to finish, no new action starts, and the agent reports what it completed and what it left undone before the state changes, so that finished work is never thrown away.
- **Work that would expose confidential material**: the agent refuses and states the reason in the thread, without echoing the material.
- **Issue content containing directives aimed at the agent**: pasted text such as "ignore your limits", "push straight to the main line", or "print the credentials" is treated as part of the request's subject matter, is not followed, and is called out in the thread as ignored.
- **Two issues demanding conflicting changes to the same content**: the second proposal is held and the conflict is pointed out in its thread.
- **Issue thread written in a language other than English**: conversations may use any language, but all committed artifacts and agent-authored repository content remain English.
- **Repository-side changes made by a human while the agent works**: the agent does not overwrite them; it reports the divergence.
- **Consumption limit reached**: the agent stops, reports that the limit was hit, and asks for an explicit decision to continue.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST let a person request agent work on an issue purely through the issue itself, with no local installation, command line, or terminal step.
- **FR-002**: The system MUST run all agent work outside the requester's machine, in an environment that is reachable and operating independently of any individual's workstation.
- **FR-003**: The system MUST accept work only for issues that are explicitly marked for agent handling, so that ordinary conversation in the repository never silently consumes agent capacity.
- **FR-004**: The system MUST acknowledge an accepted request in the issue thread before or while the work is performed.
- **FR-005**: The system MUST report the outcome of every accepted request in the issue thread in plain language, including what was done and links to every artifact produced.
- **FR-006**: The system MUST perform work of the type described in the issue and MUST NOT redefine the request on its own; when the request is ambiguous it MUST ask in the thread and wait.
- **FR-007**: The system MUST express every change to repository content as a reviewable proposal linked from the issue, and MUST NOT apply changes without an explicit human approval.
- **FR-008**: The system MUST never merge, publish, or otherwise finalize repository changes on its own initiative.
- **FR-009**: The system MUST record, in the issue thread, the identity of the person whose action started the work and of the person who approved or rejected its result.
- **FR-010**: The system MUST expose the state of the work (accepted, in progress, waiting for decision, finished, failed, halted, rejected) in the issue thread at all times.
- **FR-011**: The system MUST ensure that work which ended for any reason is not left in a non-terminal state in the thread.
- **FR-012**: The system MUST record a failure reason in the thread whenever work cannot be completed, distinguishing causes the requester can act on from causes they cannot.
- **FR-013**: The system MUST prevent two concurrent runs for the same issue.
- **FR-014**: The system MUST honour documented standing instructions stored in the repository as the agent's behavioural configuration, and MUST apply the currently committed version to new work only.
- **FR-015**: The system MUST accept a halt request from a permitted person in an issue thread, preventing any further action for that issue from starting, and MUST accept a repository-wide halt that blocks new work until lifted.
- **FR-016**: The system MUST preserve an auditable record in the repository of every request, decision, and produced artifact, such that a third party can reconstruct what happened to an issue from the repository alone; the issue thread, together with the proposals it links to, is that record, and no separate run-record files are committed for their own sake.
- **FR-017**: The system MUST enforce a per-issue consumption limit and MUST stop and ask for an explicit decision before exceeding it.
- **FR-018**: The system MUST NOT reveal confidential or secret material in issue threads or in committed content, and MUST refuse work that would require doing so.
- **FR-019**: The system MUST write all committed artifacts, comments that become part of the project record, and repository content it produces in English, while permitting the surrounding human conversation to be in any language.
- **FR-020**: The system MUST treat the GitHub repository as the only communication interface, and MUST NOT require requesters to use a terminal, chat client, or any channel outside the repository.
- **FR-021**: The system MUST authenticate to the repository with credentials that are limited to the actions the workflow needs and that are not tied to an individual maintainer's personal session.
- **FR-022**: The system MUST allow a permitted person to trigger agent handling of an existing issue using only the repository interface, with the same reliability as for a newly created issue.
- **FR-023**: The system MUST stop acting on an issue whose request was modified or withdrawn after work started, and MUST restate the version of the request it acted on.
- **FR-024**: The system MUST determine who is permitted to start, halt, and approve work from repository permissions: only people with write (push) access or higher are permitted, and actions by anyone else MUST be ignored with an explanation in the thread.
- **FR-025**: The system MUST re-check a person's permission at the moment each decision is recorded, so that a person who loses write access after starting work can no longer halt or approve it.
- **FR-026**: The system MUST start work only in response to the repository label that marks an issue for agent handling, and MUST treat halt, retry, continue, and approve as fixed command words posted by a permitted person, so that no consequential decision depends on the agent interpreting free text.
- **FR-027**: The system MUST NOT interrupt an action that is already in flight when a halt, retry, or continue command arrives; the command MUST take effect at the next action boundary.
- **FR-028**: Before reporting an issue as halted or paused, the system MUST post feedback in the thread stating what was completed, what was left undone, and what state the work ended in, so a later run can resume without redoing finished steps.
- **FR-029**: The system MUST treat all issue-thread content as data describing a request, not as instructions to itself, and MUST NOT follow embedded directives that exceed the stated request or that would relax the approval gate, the consumption limit, the permission rules, or the secrecy rules.
- **FR-030**: Whenever the system ignores an embedded directive, it MUST state in the thread that the directive was not followed and why, without repeating any secret value or restating the directive as an instruction.
- **FR-031**: The system MUST NOT retry a failed or interrupted run on its own; every attempt after the first MUST be started by an explicit retry command from a permitted person, so that a failure never silently multiplies consumption.
- **FR-032**: A run started by a retry command MUST record which earlier run it continues, so that the thread shows the sequence of attempts on one request.

### Key Entities *(include if feature involves data)*

- **Work Request**: The task expressed by a person in an issue; carries the request text, the request version that was acted on, the requesting person, and the requested kind of outcome.
- **Trigger**: The explicit signal in the repository that a work request should be handled; is either the agent-handling label or a decision command word; has an origin (new issue, existing issue, or command), an originating person, and a point in time.
- **Run**: One attempt by the agent to fulfil a work request; has a state, start and end points in time, the instruction set version it used, the actions it took, its consumption, its outcome, and, when started by a retry command, the earlier run it continues.
- **Action Boundary**: The point between two discrete steps of a run at which a pending command takes effect; no action is abandoned mid-execution at a boundary.
- **Status Update**: The visible record of a run's state in the issue thread; has a state, a point in time, and the version of the request it refers to.
- **Proposed Change**: A reviewable proposal of repository content changes produced by a run; has a scope of changed content, a link to its originating issue, and an approval state.
- **Decision**: A human approval, rejection, halt, retry, or continue; has a deciding person, a point in time, a reason, the object it applies to, and the action boundary at which it took effect.
- **Standing Instruction**: The repository-stored configuration that governs what the agent may do and how; has a version, an effective date, and a content scope.
- **Audit Entry**: The record in the issue thread, with the proposals and files it links to, that lets the history of an issue be reconstructed without consulting anything outside the repository.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person can go from opening an issue to reading a substantive agent result in that issue thread without using a terminal or installing anything, end to end in under 10 minutes for a small request.
- **SC-002**: 100% of accepted work requests receive an acknowledgement in the thread within 2 minutes of being triggered.
- **SC-003**: 100% of finished runs end in a clearly stated terminal state in the thread; zero issues are left in a non-terminal state 24 hours after their last activity.
- **SC-004**: 100% of repository changes made by the agent pass through a human decision before taking effect, verified by auditing a sample of at least 20 changes.
- **SC-005**: A third party unfamiliar with the workflow can reconstruct, from the repository alone, what happened to any randomly chosen handled issue within 5 minutes and without asking anyone.
- **SC-006**: The number of people required to have tooling installed on their own machine to use the workflow is zero.
- **SC-007**: Fewer than 5% of handled issues require a follow-up comment asking "what is the status?", measured over the first 50 handled issues.
- **SC-008**: 90% of requesters report that the issue thread alone was sufficient to understand and continue the work.
- **SC-009**: A halt request prevents any further action within 5 minutes in 100% of cases, and in every case the thread receives a feedback comment stating what was completed and what was left undone before the issue is reported as halted.
- **SC-010**: Zero confidential or secret values appear in issue threads or committed content produced by the workflow, verified by a scan of all workflow output over a 30-day period.
- **SC-011**: No agent-caused disruption to the main line of the repository occurs without a recorded human decision, over any observation window.
- **SC-012**: Consumption per issue stays within the configured limit in 100% of runs, with overruns only after an explicit recorded decision.
- **SC-013**: In 100% of halted runs, the following run resumes without repeating an already completed step, verified over the first 20 halts.
- **SC-014**: In 100% of a test set of at least 10 issues that deliberately embed directives aimed at the agent, the agent performs only the stated request, relaxes none of the approval, consumption, permission, or secrecy rules, and names the ignored directive in the thread.
- **SC-015**: Zero runs are started without an explicit trigger or retry command, verified by auditing the trigger origin of every run over a 30-day period.

## Assumptions

- **Audience**: The initial users are maintainers and contributors who already have access to the repository and are comfortable expressing tasks in issue text; they are not expected to have any engineering tooling on their own machine.
- **Platform**: GitHub Issues and the surrounding repository features are the only interaction surface; no separate chat interface, email channel, or terminal tool is part of this feature.
- **Execution environment**: A hosted, always-available environment separate from any contributor's machine performs the work. The concrete choice of that environment is an implementation decision and is out of scope for this specification.
- **Identity and permissions**: The set of people allowed to start, halt, and approve work is derived from the existing repository permission level "write (push) access and above", not from a new identity system built by this feature. Read-only contributors and outside commenters can read everything in the issue thread but cannot drive the agent.
- **Approval discipline**: The agent is treated as a contributor without merge rights; protecting the main line and requiring review remain the repository owner's responsibility and are assumed to stay enabled.
- **Single repository**: The workflow operates on the current repository only; multi-repository orchestration is out of scope.
- **Concurrency**: Demand is low enough that per-issue serialization is sufficient; global fairness and queueing policies beyond "do not start more than the configured number of concurrent runs" are out of scope.
- **Language standard**: Per the project constitution, all artifacts and repository content produced by the workflow are English; issue conversations may be in any language.
- **Consumption model**: Agent usage has a cost that must be bounded; a per-issue limit exists and is configurable from repository content.
- **Data retention**: The repository's own history and issue threads are the retention mechanism; no separate long-term store of issue content and no per-run record files are introduced, and no retention period beyond the repository's is required.
- **Availability expectation**: The workflow is best-effort and asynchronous; requesters accept that results arrive later rather than in a live session, but a request must never disappear without a recorded state.
- **Trust model**: People with write access are trusted in intent, but the content they paste into an issue is not trusted as instruction. The workflow is not defended against a maintainer who deliberately rewrites the standing instructions or approves a harmful proposal, because that person already holds the power to do so directly.
