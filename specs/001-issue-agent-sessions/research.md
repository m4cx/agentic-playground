# Research: Issue-Driven Agent Sessions

**Feature**: `001-issue-agent-sessions` | **Date**: 2026-10-28

All unknowns from the Technical Context are resolved below. Sources are the installed Pi 1.4.0
documentation under `node_modules/@earendil-works/pi-coding-agent/docs/`, the feature
[spec.md](./spec.md), and the repository's existing TypeScript configuration.

---

## D1 — Where the agent runs

**Decision**: GitHub-hosted ephemeral Ubuntu 24.04 runners started by repository events.

**Rationale**: The feature's only interface is the repository. A hosted runner turns the trigger
event into compute with no infrastructure to own, no long-lived credential, and no state that
survives a bad run. It satisfies FR-023 (independent of the requester's workstation) and the
assumption that the runtime is hosted. Ephemerality also makes the agent's blast radius a single
job: the next run starts from a clean machine.

**Alternatives considered**:
- *Self-hosted runner*: persistent, needs patching, and a compromise survives between runs. Rejected
  for the first version; the orchestrator would work unchanged behind it later.
- *Long-lived service (VM/container)*: better warm-start latency but adds deployment, secret storage,
  and an ingress surface that a repository-only workflow does not need.
- *Running the agent on the requester's machine*: violates the core requirement.

**Accepted limits**: job-queue latency (recorded in the acknowledgement), the platform's job ceiling
(mitigated by a 60-minute job timeout and a 45-minute agent deadline), and no shared state between
jobs (solved by D5).

---

## D2 — How the orchestrator drives Pi

**Decision**: Pi in **RPC mode** (`pi --mode rpc`), driven by a small JSONL client over the
documented protocol. The orchestrator launches the pinned CLI with `sudo -u agent-egress`; the
shipped `RpcClient` is not used because it always spawns `node` as the current user and would bypass
the UID boundary.

**Rationale**: The orchestrator must start a long-running session, observe completion
(`agent_settled`), enforce a deadline, disable automatic retries (`set_auto_retry`), and resume the
same conversation by ID. RPC provides all of this over a documented JSONL wire protocol and keeps
Pi in a child process, which is required for the privilege split in D3. A small client is enough:
the used subset is `set_auto_retry`, `get_state`, `prompt`, `get_last_assistant_text`,
`get_session_stats`, and `abort`. The SDK would embed Pi in the orchestrator, collapsing the process
boundary that keeps the GitHub token out of the agent.

**Alternatives considered**:
- *Print mode (`-p`)*: only the final text is visible; no state inspection, no clean abort, no
  session resume.
- *JSON mode (`--mode json`)*: structured progress, but one-directional; stopping would require
  signals against an agent mid-tool-call.
- *TypeScript SDK in-process*: convenient, but removes the process boundary and couples the
  orchestrator to SDK internals rather than a documented protocol.

**Lifecycle**: Start Pi with `--session-id`, `--session-dir`, `--model`, `--tools`, `--no-approve`,
`--append-system-prompt`, and resource discovery disabled. Send one `prompt`, consume events until
`agent_settled` or the deadline, then read `get_last_assistant_text`. Close stdin for orderly
shutdown and kill the process group on timeout.

---

## D3 — Credential and privilege split, and network egress

**Decision**: The orchestrator owns `GITHUB_TOKEN` and performs every GitHub and Git write. Pi runs
as a dedicated unprivileged user (`agent-egress`, UID 1500) with no token and a default-deny egress
policy that allows only DNS, loopback, established flows, the model provider, and the declared package
registries.

**Rationale**: FR-010 and FR-020 require that the agent cannot merge, leak secrets, or bypass the
review gate. Removing the token from the agent process makes prompt injection unable to push, comment,
or open a pull request even if the model is fully convinced. The egress rules implement FR-026 and
close the exfiltration path from hostile issue text. Running Pi under a separate UID lets iptables'
owner match scope the policy to the agent without restricting the orchestrator's GitHub access. A
rate-limited `LOG` rule before the drop makes blocked attempts reportable in the issue thread
(SC-011).

**Implementation**: `.github/scripts/agent-egress.sh` creates the UID, resolves the allowlisted hosts
to IPv4 addresses, applies `iptables` owner-match rules, and drops all other traffic from that UID
(fail closed if the allowlist is empty or a host cannot be resolved). The workspace is made traversable
and writable for the agent user; the orchestrator commits afterwards as the runner user. IPv6 is
dropped for the agent UID.

**Alternatives considered**:
- *Pass `GITHUB_TOKEN` to Pi and trust the instructions*: one successful injection becomes a
  repository write. Rejected.
- *Proxy-only enforcement*: a local allowlisting proxy is useful, but without an OS-level block the
  agent can bypass `HTTP_PROXY`. The UID firewall is the primary boundary.
- *Unrestricted egress with post-hoc log inspection*: detection is not prevention; FR-026 asks for
  blocking.

**Accepted limits**: resolving allowlisted hosts at job start can break if a provider rotates IPs
mid-run. The policy fails closed and the thread reports an `environment` failure; the allowlist is
configuration, not code.

---

## D4 — Trigger and state representation

**Decision**: The `issues.labeled` event with the configured trigger label (default `agent:run`)
starts a session. The label is removed as soon as the run is accepted, so it acts as a one-shot
trigger and can be re-applied to resume. The explicit resume signal is a comment whose first line
matches the configured command (default `/agent continue`), or a renewed label application on an
open issue. Ordinary comments never start work.

**Rationale**: This follows the clarifications directly. A label is permission-gated, visible in the
issue list, and works for new and existing issues (FR-001, FR-022). Removing it after acceptance
avoids duplicate `labeled` events and makes "re-apply the label" a real resume signal. The comment
command carries the follow-up text that the next run needs.

**Alternatives considered**:
- *Every comment starts work*: rejected in clarification; it spends capacity on "thanks" and makes
  start times unpredictable.
- *Assignment to a bot account*: needs a second identity and still does not distinguish start from
  resume.
- *External queue or database*: adds a dependency and contradicts the thread-as-record model.

**State representation**: A single bot-owned state comment holds a versioned JSON marker in an HTML
comment. It carries the session ID, slug, branch, state, request hash, PR number, last trigger, and
run history. The marker is updated in place; result comments are append-only. This keeps the
authoritative state in the thread, is readable by humans as a rendered summary, and is machine-readable
without a database.

**Risk accepted**: any user with write access can edit or delete the bot comment. That user can also
drive the agent directly, so no privilege is gained; the orchestrator detects a missing or malformed
marker and rebuilds it from the thread and branch, reporting the recovery.

---

## D5 — Continuity between runs

**Decision**: Best-effort Pi session continuity through an `actions/cache` entry keyed by issue number
and a configuration fingerprint, with a thread digest as the fallback. The cache stores only the
session directory; it is never authoritative.

**Rationale**: FR-014 requires prior context to be retained when a session resumes. Pi can resume by
session ID, which preserves tool history and working context cheaply. Caches are evictable, so the
orchestrator always builds a digest from the issue body, relevant comments, prior result summaries,
the branch diff, and any unresolved conflicts. If the cache is missing, Pi starts a fresh conversation
seeded with that digest; the session identity and branch remain the same.

**Fingerprint**: hash of `instructions.md`, `.agent/config.json`, the model ID, the tool allowlist,
and the pinned Pi version. A change starts a new Pi session ID (`issue-<n>-<fingerprint8>`) so a
resumed session cannot replay stale system instructions or an old tool list. The state marker records
the active Pi session ID and its fingerprint.

**Alternatives considered**:
- *Always reconstruct from the thread*: simplest and always works, but a long thread burns tokens
  re-reading its own history. Kept as the fallback.
- *Commit session files to the repository*: contradicts the spec's decision that the thread is the
  record and no per-run files are committed for their own sake.
- *Workflow artifacts as the primary store*: cross-run artifact discovery is awkward and artifacts
  expire; the cache API is the supported cross-run mechanism.

---

## D6 — Branch and pull-request lifecycle

**Decision**: One branch per issue, named `feature/<issue-number>-<slug>`. The slug is fixed when the
session starts. The orchestrator creates the branch on the first run that produces file changes,
commits with a deterministic English message, pushes without force, opens or updates a pull request
to the default branch, and comments the links in the issue. On resume it checks out the same branch
and merges the current default branch before the agent starts.

**Rationale**: This is the literal requirement from the user and FR-006/FR-012. A single branch per
issue prevents branch proliferation and makes the session-to-branch mapping obvious. Merging the
default branch (rather than rebasing) preserves history and respects FR-010's no-force-push rule
while giving the agent the latest code to test against (FR-027). Pull-request creation is idempotent:
find an open PR whose head is the branch before creating one.

**No-change sessions**: Every run that reaches `finished` or `waiting` creates the branch and the pull
request. If the agent produced no file changes, the branch carries one empty commit that records the
session outcome, and the pull request carries the result summary with an empty diff. This keeps the
invariant that every completed session has exactly one branch and one review artifact (SC-002,
FR-006, FR-012) instead of creating a special case. A failed run commits any partial file changes as a
work-in-progress commit and pushes the branch, but does not open a pull request.

**Alternatives considered**:
- *Rebase onto the default branch*: linear history, but rewrites commits and requires a force-push,
  which FR-010 forbids.
- *Leave the branch stale until review*: the agent would test against old code and conflicts would
  surface late.
- *One PR per run*: produces multiple review artifacts for one session and breaks the "one issue =
  one session" mapping.

**Slug rule**: Lowercase, transliterate to ASCII where possible, replace runs of non-alphanumeric
characters with `-`, trim hyphens, truncate to 50 characters at a hyphen boundary, and fall back to
`issue` when nothing remains. The slug is fixed on first run and stored in the state marker so a title
edit cannot rename the branch.

---

## D7 — Retry, timeout, and failure semantics

**Decision**: No automatic retries. Pi's automatic retry is disabled through RPC
(`set_auto_retry { enabled: false }`); any retry event aborts the run and fails it with
`unexpected-retry`. A 45-minute agent deadline and a 60-minute job timeout bound the run. A failed
session is resumed only by the explicit resume signal.

**Rationale**: FR-017 prohibits automatic retries; a retry hidden inside the harness would silently
multiply work and contradict the thread's attempt history. A deadline prevents a wedged provider or
tool from holding the job until the platform ceiling. Failure is a first-class state with a reason
and a next action, not an unhandled exception.

**Alternatives considered**:
- *One retry for transient provider errors*: convenient, but hides an attempt the thread reports as
  one run and was explicitly ruled out by the spec's "no automatic retry".
- *Wall-clock timeout only*: bounds duration but not a hung child process; the orchestrator kills the
  process group at the deadline and reports `timeout`.

---

## D8 — Language and generated artifacts

**Decision**: Every durable artifact the orchestrator or agent produces is English. Issue title,
body, and comments are passed to the model as data and are never translated into the record. The
agent's structured output is validated and rendered through English templates; raw model prose is
not posted as the durable summary.

**Rationale**: Constitution principle I and FR-021. Rendering through templates means a model that
answers in German (because the issue is German) cannot accidentally put German into the issue record,
the PR description, the commit message, or the state comment. The agent may still read and understand
non-English issue content; it must write its deliverables in English.

**Alternatives considered**:
- *Let the agent write the whole thread message*: natural, but makes the language of the project
  record depend on the model's adherence. Rejected.
- *Translate inbound issues*: violates the constitution's inbound-content rule and loses nuance.
  Rejected.

---

## D9 — Configuration

**Decision**: One reviewed JSON file, `.agent/config.json`, is the single schema for trigger label,
resume command, branch prefix, slug length, model, thinking level, tool allowlist, instructions path,
network allowlist, deadlines, and comment-read bounds. The loader validates unknown keys, missing
keys, and out-of-range values and fails closed before any model call.

**Rationale**: Behaviour must be reviewable repository content (the spec's trust model) and must not
be scattered through workflow YAML. JSON avoids an extra parser dependency and is natively readable by
TypeScript. The workflow's event filters mirror the trigger label and resume command; a contract test
reads both files and fails if they diverge.

**Alternatives considered**:
- *YAML with a parser dependency*: nicer comments, but adds a runtime dependency for no functional
  gain.
- *Environment variables only*: invisible to reviewers and easy to drift.
- *Hardcoded constants*: makes a behaviour change a code change and hides it from the repository
  configuration review.

---

## D10 — GitHub API and permission model

**Decision**: A thin REST client over the built-in `fetch`, authenticated with the job's
`GITHUB_TOKEN`. Start and resume require an effective repository permission of `write`, `maintain`,
or `admin`, checked through the collaborators-permission endpoint at the time of the trigger. Comments
from bots and comments on pull requests are ignored. Merge decisions rely on GitHub's own permission
model; the orchestrator only observes them.

**Rationale**: `author_association` cannot distinguish read from write collaborators, so the
permission endpoint is the accurate check. Re-checking at trigger time means a person who lost write
access after a previous run cannot resume it. The token is scoped by the workflow's `permissions`
block to the minimum the job needs. GitHub remains the authority for who may merge.

**Alternatives considered**:
- *`author_association`*: simple but wrong for read-only collaborators and organization teams.
- *A separate bot account or GitHub App*: better long-term identity, but adds key management and
  installation steps; the job token is sufficient for a single repository and rotates per job.

---

## D11 — Testing strategy

**Decision**: Unit tests with `node:test` over pure modules; integration tests with an in-memory fake
GitHub client and a scripted fake RPC peer; contract tests that read the workflow YAML and
`.agent/config.json` and assert their shared strings and schemas agree.

**Rationale**: The risky logic is the state machine, trigger parsing, permission gate, branch/slug
rules, and the agent-output parser — all testable without a network or a real model. The fake RPC peer
lets the integration tests drive the full lifecycle deterministically. Contract tests catch the most
likely operational failure: changing the label or resume command in one place but not the other.

**Alternatives considered**:
- *End-to-end tests against a live model*: slow, costly, and non-deterministic; reserved for the
  manual quickstart scenarios.
- *Mocking `fetch` globally*: brittle; an injected client is clearer and keeps tests parallel-safe.

---

## D12 — Model provider

**Decision**: Define one provider in `.agent/models.json` and select it in `.agent/config.json`. The
initial deployment uses an OpenAI-compatible Ollama Cloud endpoint with an API key from
`OLLAMA_API_KEY`, matching the repository's earlier provider direction. The provider block is the only
place a provider endpoint is named; the egress allowlist names the same host.

**Rationale**: Pi needs a concrete model ID and provider to run unattended; the repository already
chose Ollama Cloud once, and keeping it avoids a second decision. Isolating the provider in two
reviewed files makes a later switch a configuration change, not a code change. The egress allowlist
must match the provider host or the agent cannot reach the model, which is caught by the quickstart
probe.

**Alternatives considered**:
- *Hardcode a provider in the orchestrator*: unreviewable and couples runtime to a vendor.
- *Leave the provider undefined*: the agent cannot start; a plan-level unknown would block
  implementation.

---

## D13 — Open risks

| Risk | Mitigation |
|------|------------|
| GitHub Actions cache eviction loses Pi context | Thread digest fallback; state marker is authoritative |
| Provider IP rotation breaks the resolved allowlist | Fail closed with `environment` failure; allowlist is configurable; rerun resolves again |
| Non-English issue title yields a non-English slug | ASCII normalization and `issue` fallback; slug is a mechanical identifier, all other branch components are fixed English |
| A model ignores the structured-output contract | The run fails with a clear `agent-output` reason; no raw prose is posted as a record |
| A human edits the state comment | Marker validation rebuilds from the thread and branch, or fails safely; write access already implies control |
| Workflow YAML and config drift | Contract test reads both and fails CI on mismatch |
| Egress rules need root | GitHub-hosted Ubuntu runners provide passwordless `sudo`; the script fails closed if it cannot apply the policy |
