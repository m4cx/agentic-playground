# Feature Specification: Issue-Driven Agent Sessions

**Feature Branch**: `001-issue-agent-sessions`

**Created**: 2026-10-28

**Status**: Draft

**Input**: User description: "I want to send a coding agent off based on GitHub issues. The coding agent should process the content of the issue and write the result back into the repository — on a feature branch named `feature/{issue-id}-{issue-slug}`. One issue = one agent session."

## Clarifications

### Session 2026-10-28

- Q: How should a person signal that an issue should be handed to the coding agent? → A: Apply an explicit label (default `agent:run`) to the issue.
- Q: When the agent has finished an issue, what should it do with the feature branch besides pushing it? → A: Open or update a pull request from the feature branch and comment the result in the issue; a human merges.
- Q: Should the coding agent be allowed to reach the open internet while it works on an issue? → A: Only the model provider and explicitly listed package registries; all other outbound traffic is blocked.
- Q: What should cause the agent to resume an existing issue session after a run has finished? → A: Only an explicit resume signal (a fixed resume command or re-applying the agent-handling label); ordinary comments do not start work.
- Q: When the default branch has moved on since the feature branch was created, how should the agent bring the feature branch up to date before continuing work? → A: Merge the current default branch into the feature branch before continuing.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Turn an issue into work on a feature branch (Priority: P1)

A repository member opens an issue describing a coding task and applies the agent-handling label to it. The agent receives the issue as its task, performs the work in an environment independent of the requester's machine, commits the result to a branch named `feature/{issue-id}-{issue-slug}` in the same repository, and posts a summary comment linking the branch and its pull request in the issue thread.

**Why this priority**: This is the core value of the feature. Without a reliable path from issue to branch, no other capability matters. Delivered alone, it already replaces a local coding session for the requester.

**Independent Test**: Open a small, self-contained issue, apply the agent-handling label from an account with write access, and confirm that the agent acknowledges the request, creates a branch with the expected name, commits changes that address the issue, and reports the result in the thread without any local execution.

**Acceptance Scenarios**:

1. **Given** an open issue that a permitted person labels for agent handling, **When** the label is applied, **Then** the issue receives an acknowledgement naming the agent session and the feature branch, and work starts.
2. **Given** an issue whose work the agent has completed, **When** the requester opens the repository, **Then** a branch named `feature/{issue-id}-{issue-slug}` exists in the same repository and contains commits that address the issue.
3. **Given** a completed agent session, **When** the requester reads the issue thread, **Then** a summary states what changed, links the branch and review artifact, lists the verification performed, and names any open questions or limitations.
4. **Given** an issue that does not carry the agent-handling label, **When** anyone comments on it, **Then** no agent session starts and no agent capacity is consumed.
5. **Given** an agent-handled issue, **When** the requester follows the whole flow, **Then** no step requires software installed or commands run on the requester's machine.

---

### User Story 2 - Continue the same session through follow-up comments (Priority: P2)

After the first result, the requester posts an explicit resume signal — the documented resume command or a renewed application of the agent-handling label — together with a correction, an additional requirement, or a review remark. Because one issue maps to one agent session, the agent resumes that same session with its prior context and updates the same feature branch instead of starting a new session or creating a second branch. Ordinary comments without the resume signal remain conversation and do not start work.

**Why this priority**: Issue work is rarely finished in one pass. Without continuity, the requester has to restate context, the agent repeats finished work, and several branches compete for the same issue. This story turns a one-shot job into a usable collaboration.

**Independent Test**: After a completed first run, post a follow-up together with the resume signal from a permitted account and confirm that the agent resumes the same session, updates the same branch, and does not create a second branch or session for the issue.

**Acceptance Scenarios**:

1. **Given** an issue with a completed agent run, **When** a permitted person posts the resume signal with a follow-up, **Then** the agent resumes the same session and updates the existing feature branch.
2. **Given** a resumed session, **When** the agent reports its result, **Then** it states which earlier work it reused and which parts it changed, and it does not create a second branch for the issue.
3. **Given** a resume signal from a person without write access, **When** it is posted, **Then** no work starts and the thread explains that write access is required.
4. **Given** a closed issue, **When** a comment is posted, **Then** no session resumes until the issue is reopened and an explicit resume signal is given.
5. **Given** a resumed session whose feature branch is behind the default branch, **When** the agent continues work, **Then** it merges the current default branch into the feature branch first and reports any conflict it could not resolve.

---

### User Story 3 - Review the agent's work before it reaches the default branch (Priority: P2)

The agent's result arrives on the issue's feature branch and is offered as a reviewable change against the default branch. A maintainer reviews it, requests changes if needed, and decides when it becomes part of the main line. The agent never merges on its own.

**Why this priority**: Letting an autonomous agent write to the main line without a human gate is unacceptable for repository integrity. The feature is only safe to enable once this gate is explicit, and it is the second thing a maintainer asks for after the first demo.

**Independent Test**: Trigger work on an issue, verify that a reviewable change from the feature branch is linked in the thread, verify that the default branch is untouched while the change is unreviewed, and verify that only an explicit human merge makes it part of the main line.

**Acceptance Scenarios**:

1. **Given** a feature branch produced by an agent session, **When** the agent finishes a run, **Then** a reviewable change targeting the default branch is created or updated and linked from the issue thread.
2. **Given** an unreviewed agent change, **When** no human has approved or merged it, **Then** the default branch remains unchanged by the agent.
3. **Given** an agent change that a human merges, **When** the merge is recorded, **Then** the issue thread records who merged it and when, and the session reaches a terminal state.
4. **Given** an agent change that a human rejects or returns with requested changes, **When** the decision is recorded, **Then** the agent does not apply the change on its own and the next resume signal continues the same session.

---

### User Story 4 - Follow the state of an agent session from the issue (Priority: P3)

A requester returns to an issue later and wants to know what happened. The thread shows whether the session is accepted, working, waiting for input, finished, failed, or stopped, so the requester never has to guess whether the agent is still busy or silently dead.

**Why this priority**: The workflow is asynchronous and unattended. Visible state builds trust and prevents duplicate triggers. It is a smaller increment than the first three stories and can follow them.

**Independent Test**: Start work on an issue, observe the state in the thread across the run, and confirm that the session ends in a recorded state with no ambiguity.

**Acceptance Scenarios**:

1. **Given** an agent session in progress, **When** the requester checks the issue, **Then** the current state is visible without asking a follow-up question.
2. **Given** an agent session that has ended, **When** the requester checks the issue, **Then** the state is a terminal state or an explicit wait for a named human decision, and never "working".
3. **Given** a session that could not complete the request, **When** the requester reads the issue, **Then** the reason and the next possible action are stated in plain language.

---

### Edge Cases

- **Issue title changed after the session started**: the branch name stays stable for the lifetime of the issue; the agent reports the version of the request it is acting on.
- **Issue edited, closed, or withdrawn while the agent is working**: the agent stops at the next safe boundary, reports the version of the request it acted on, and leaves already committed work on the branch.
- **Duplicate or repeated trigger**: a second session is not started while one is active, and repeated triggers do not multiply work or spend.
- **Title with no usable characters or an extremely long title**: the slug falls back to a safe value and is truncated without producing an invalid branch name.
- **Follow-up message contains a new, unrelated task**: the agent points out that the issue is bound to one session and asks for a separate issue instead of silently widening scope.
- **Issue content embeds instructions aimed at the agent** (for example "ignore your rules", "push to the default branch", "print the credentials"): the content is treated as part of the request's subject matter, is not followed, and is called out in the thread.
- **Agent lacks permission to push or open a review**: the session fails with a clear statement of the missing permission and the next action, leaving the repository untouched.
- **Feature branch already exists for the issue**: the agent continues on that branch instead of creating a new one or discarding existing commits.
- **Human changed the feature branch while the agent worked**: the agent does not overwrite the human's work silently; it reconciles or reports the divergence.
- **Work that would expose confidential material**: the agent refuses and states the reason in the thread without echoing the material.
- **Two issues request conflicting changes to the same content**: each issue keeps its own branch; the conflict is surfaced in the threads and resolved by humans, not by silently merging one over the other.
- **Merging the default branch into the feature branch produces a conflict**: the agent resolves it only where the issue makes the intended outcome unambiguous; otherwise it stops, reports the conflicting files, and leaves the decision to a human.
- **Issue content tries to send repository data or credentials to an undeclared host**: the connection is blocked, the attempt is reported in the thread without echoing sensitive values, and the session does not treat the instruction as authorized.
- **Agent run fails partway through**: the session ends as failed with a reason, no automatic retry follows, and an explicit resume signal from a permitted person resumes the same session.
- **Issue thread written in a language other than English**: human conversation may use any language, but all agent-authored repository content and thread artifacts remain English.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST start agent work only when an authorized person applies the configured agent-handling label (default `agent:run`) to an issue, and applying that label MUST be the only way to start a new session.
- **FR-002**: The system MUST create exactly one agent session per triggered issue and MUST bind that session to that issue only.
- **FR-003**: The system MUST ensure that at most one agent session is active for an issue at any time, and repeated triggers while a session is active MUST NOT start a second session.
- **FR-004**: The agent MUST treat the issue title, body, comments, and linked content as the task description and as data, not as instructions that can override repository rules, permissions, secrecy rules, or the review gate.
- **FR-005**: When a session starts, the system MUST post an acknowledgement in the issue thread naming the session and the feature branch.
- **FR-006**: The agent MUST write the result of the session as commits in the same repository on a branch named `feature/{issue-id}-{issue-slug}`.
- **FR-007**: The system MUST derive `issue-id` from the issue's repository-unique identifier and `issue-slug` from the issue title by lowercasing, replacing runs of non-alphanumeric characters with a single hyphen, trimming leading and trailing hyphens, truncating to at most 50 characters without ending in a hyphen, and falling back to `issue` when no usable characters remain.
- **FR-008**: The system MUST derive the slug once when the session first starts and keep it stable for the lifetime of the issue, so that later runs reuse the same branch even if the title changes.
- **FR-009**: The agent MUST base the feature branch on the current default branch when it first writes, and MUST continue an existing branch for the same issue instead of recreating or resetting it.
- **FR-010**: The agent MUST NOT commit to the default branch or to any branch not associated with the issue, MUST NOT merge the feature branch into any other branch, and MUST NOT force-push or delete branches.
- **FR-011**: The agent MUST commit only changes that serve the issue; unrelated or incidental changes MUST NOT be committed.
- **FR-012**: The agent MUST open or update a pull request from the feature branch against the default branch and MUST link it from a comment in the issue thread, while leaving the merge decision to a human.
- **FR-013**: The agent MUST post a result summary comment in the issue thread stating what changed, the branch and review link, the verification performed, any open questions or limitations, and the resulting session state.
- **FR-014**: An explicit resume signal from an authorized person on an open issue — either the documented resume command (default `/agent continue`) posted as a comment or a renewed application of the agent-handling label — MUST resume the same session on the same branch with the prior context retained; no new session or branch is created, and ordinary comments without the signal MUST NOT start work.
- **FR-015**: The system MUST ignore triggers and resume signals from people without write access and explain in the thread that write access is required.
- **FR-016**: The system MUST expose the session state — accepted, working, waiting for input, finished, failed, or stopped — in the issue thread, and every session MUST end in a recorded state.
- **FR-017**: When the agent cannot complete the request, it MUST state the reason and the next possible action in the thread and MUST NOT retry automatically; only an explicit resume signal from an authorized person resumes the session.
- **FR-018**: If the issue is edited, closed, or withdrawn while the agent works, the agent MUST stop at the next safe boundary, report the request version it acted on, and leave already committed work on the branch.
- **FR-019**: If a human changed the feature branch while the agent was working, the agent MUST NOT silently overwrite those changes; it MUST reconcile them or report the divergence.
- **FR-020**: The agent MUST NOT reveal confidential or secret material in commits, review artifacts, or thread comments, and MUST refuse work that would require doing so.
- **FR-021**: All agent-authored artifacts — code, comments that become part of the project record, documentation, commit messages, review descriptions, and branch names — MUST be written in English, while human conversation in the issue may be in any language.
- **FR-022**: The system MUST record in the issue thread the trigger origin, the trigger time, the session start and end, and the mapping from issue to session to feature branch.
- **FR-023**: The system MUST run agent work in an environment reachable independently of any requester's workstation, and requesters MUST NOT need local tooling to use the workflow.
- **FR-024**: The system MUST keep a session available across multiple runs for the same issue until the issue is closed or the session is explicitly ended, and MUST NOT reuse a session for a different issue.
- **FR-025**: The agent MUST report any part of the request it could not complete instead of presenting the run as fully successful.
- **FR-026**: The agent's outbound network access MUST be denied by default and limited to the model provider endpoint and explicitly listed package registry endpoints; all other outbound connections MUST be blocked.
- **FR-027**: Before continuing work on an existing feature branch, the agent MUST merge the current default branch into the feature branch, resolve conflicts only where the issue makes the intended outcome unambiguous, and report any unresolved conflict instead of rewriting history, force-pushing, or leaving the branch silently stale.

### Key Entities *(include if feature involves data)*

- **Issue Work Request**: The task expressed in a repository issue; carries the issue identity, the requesting person, the request content and its version, and the requested outcome.
- **Agent Session**: One ongoing agent conversation bound to one issue; has an identity, an owner issue, a state, start and end points in time, accumulated context, and the sequence of runs it served.
- **Trigger**: The explicit signal that starts or resumes work; originates from an authorized person applying the agent-handling label, re-applying it, or posting the resume command, and has a point in time.
- **Feature Branch**: The branch named `feature/{issue-id}-{issue-slug}` that carries the session's committed result; has a base commit, the commits produced by the session, and a link to its review artifact.
- **Produced Change**: A commit or set of commits on the feature branch that addresses part of the issue; has a scope, a link to the originating issue, and a review state.
- **Review Artifact**: The reviewable change offered against the default branch; has a target branch, a review state, the deciding person, and a point in time.
- **Status Update**: The visible record of a session's state in the issue thread; has a state, a point in time, and the request version it refers to.
- **Session Record**: The thread-visible mapping of trigger, session, branch, commits, decisions, and outcome from which the history of an issue can be reconstructed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An authorized person can go from applying the agent-handling label to reading a result summary and branch link in the thread without using a terminal or installing anything, within 15 minutes for a small request.
- **SC-002**: 100% of completed sessions produce exactly one branch matching `feature/{issue-id}-{issue-slug}`, and zero agent commits land on the default branch without a human merge.
- **SC-003**: 100% of issues have at most one active session, verified by auditing a 30-day window; no issue ever runs two sessions concurrently.
- **SC-004**: At least 95% of explicit resume signals from authorized people resume the same session on the same branch without creating a second branch, measured over the first 50 resumes.
- **SC-005**: 100% of sessions end in a recorded state, and zero sessions remain "working" 24 hours after their last activity.
- **SC-006**: 100% of failed sessions state a reason and a next possible action in the thread in plain language.
- **SC-007**: A third party unfamiliar with the workflow can reconstruct what happened to any randomly chosen handled issue — trigger, session, branch, commits, review, and outcome — from the repository alone within 5 minutes and without asking anyone.
- **SC-008**: Zero confidential or secret values appear in agent-authored commits, review artifacts, or thread comments, verified by a scan of all session output over a 30-day period.
- **SC-009**: At least 90% of requesters report that the thread summary plus the feature branch were sufficient to understand the result and continue the work, measured over the first 50 completed sessions.
- **SC-010**: 100% of branch names are predictable from the issue identity and title before the agent starts, verified against 20 issues with varied titles, including long, non-ASCII, and punctuation-heavy titles.
- **SC-011**: Zero outbound connections from the agent process to hosts outside the declared allowlist are observed over a 30-day period, and every blocked attempt is reported in its issue thread.
- **SC-012**: Zero agent runs are started by ordinary comments, and every run after the first is traceable to an explicit resume signal, verified over a 30-day window.
- **SC-013**: 100% of resumes on a feature branch that is behind the default branch integrate the current default branch before the agent reports completion, and every unresolved conflict is named in the thread, verified over the first 20 resumes.

## Assumptions

- **Platform**: GitHub Issues in a single repository are the only interaction surface; no chat client, email channel, or terminal tool is part of this feature. Multi-repository orchestration is out of scope.
- **Authorization**: Permission to trigger, resume, and review is derived from the existing repository permission level "write (push) access and above"; no new identity system is introduced. Read-only contributors can follow the thread but cannot drive the agent.
- **Delivery form**: The feature branch is the authoritative result. The agent opens or updates a pull request from that branch to the default branch and comments the result in the issue; merging is always a human decision.
- **Session continuity**: One issue equals one session for the issue's lifetime. Ordinary comments are conversation only; resuming requires the documented resume command or a renewed label application. Reopening a closed issue and giving the resume signal continues the existing session rather than creating a new one. A follow-up that introduces an unrelated task is redirected to a new issue.
- **Slug rule**: The slug is fixed when the session first starts and is based on the issue title, truncated to 50 characters, so the branch name cannot collide or change later.
- **Execution environment**: Agent work runs in a hosted environment independent of any contributor's machine. The concrete runtime and model provider are implementation decisions and out of scope for this specification.
- **Concurrency**: Per-issue serialization is sufficient for the expected demand; global fairness and queueing policies beyond "one active session per issue" are out of scope.
- **Trust model**: People with write access are trusted in intent, but issue content — including pasted text and comments — is not trusted as instruction and cannot relax repository rules.
- **Language standard**: Per the project constitution, all agent-authored artifacts and repository content are English; human conversation in issues may be in any language.
- **Retention**: The repository's own history and issue threads are the retention mechanism; no separate long-term store and no per-run record files are introduced.
- **Review discipline**: The agent is treated as a contributor without merge rights; branch protection and required review on the default branch are assumed to remain enabled.
- **Network policy**: The agent process runs with default-deny egress; only the model provider endpoint and the package registries declared in repository configuration are reachable, and every other outbound connection is blocked and reported.
- **Branch freshness**: On each resume the feature branch is merged with the current default branch rather than rebased, so history is preserved and the no-force-push rule holds.
- **Out of scope**: Automatic merging, automatic retries, multi-repository workflows, cost or budget enforcement, and interactive real-time sessions are not part of this feature.
