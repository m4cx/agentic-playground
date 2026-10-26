# Research: Issue-Driven Agentic Workflow

**Feature**: `001-issue-driven-agent-workflow` | **Date**: 2026-10-26

All unknowns from the Technical Context are resolved below. Each entry states the decision, why it
was chosen, and what was rejected. Sources are the installed Pi 1.4.0 documentation under
`/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/` and the feature spec.

---

## D1 — Where the agent runs

**Decision**: GitHub-hosted ephemeral runner (`ubuntu-24.04`) started by workflow events.

**Rationale**: The feature's first constraint is "not on the local machine" and the second is "only
the repository as interface". A hosted runner satisfies both with no infrastructure to own: the
event that carries the trigger is the same event that starts the compute, the runner is a fresh
virtual machine per job, its log retention is the platform's, and no long-lived host holds a
repository credential between runs. Ephemerality is also the cheapest isolation available — nothing
the agent does survives the job, so a bad run cannot poison the next one.

**Alternatives considered**:
- *Self-hosted runner*: persistent, needs patching, and an attacker who reaches it keeps a foothold
  between runs. Rejected for the first version; remains possible later behind the same orchestrator.
- *Long-lived hosted service (container app / VM)*: better for warm starts and sub-second
  acknowledgement, but adds a deploy target, a secret store, and a public ingress surface that a
  repository-only workflow does not need. Rejected as premature.
- *Running Pi on the requester's machine through a webhook*: violates the core requirement.

**Known limits accepted**: job queue latency (affects SC-002's two-minute acknowledgement),
6-hour maximum job duration (mitigated by a hard timeout in D6), and no state shared between job
invocations (addressed by D5).

---

## D2 — How the orchestrator drives Pi

**Decision**: Pi in **RPC mode** (`pi --mode rpc`), driven by `RpcClient` from
`@earendil-works/pi-coding-agent`, pinned to version 1.4.0.

**Rationale**: The spec needs four capabilities that only the bidirectional mode provides:
inspecting cumulative consumption during a run (`get_session_stats` returns tokens and cost), stopping
at an action boundary (`abort` waits for the session to become idle instead of killing a tool
mid-flight, which is exactly FR-027), disabling the harness's own transient-error retry
(`set_auto_retry`, needed for FR-031), and resuming one conversation across job invocations
(`--session-id`, needed for SC-013). Print mode exposes none of these; JSON mode is one-directional
and would force process signals to stop a run.

**Alternatives considered**:
- *Print mode (`-p`)*: simplest, but only the final text is exposed — no cost visibility, no
  boundary stop, no session control.
- *JSON mode (`--mode json`)*: structured progress, but the prompt set is fixed at start and the
  process cannot be asked to do anything. Halting would mean signal handling against an agent that
  is mid-tool-call.
- *TypeScript SDK in-process*: most control, but embeds the harness in the orchestrator, so a Pi
  crash or runaway tool takes the orchestrator with it, and it couples the runner to SDK API churn
  rather than to a documented wire protocol.

**Boundary semantics**: "abort at the next action boundary" is implemented as *observe a pending
halt, then let the current turn finish, then send `abort`*. Pi's own `steer` is deliberately not used
for halts, because steering inserts an instruction rather than ending the run.

---

## D3 — What Pi may load as configuration

**Decision**: Run Pi with project-trust-gated resources **disabled**, an explicit instruction file
(`--append-system-prompt .agent/instructions.md`), and an explicit tool allowlist
(`--tools read,bash,edit,write,grep,find,ls`).

**Rationale**: Pi's own documentation warns that project trust controls *which resources load*, not
what they may do: `.pi/extensions`, `.pi/settings.json`, `.pi/mcp.json`, and `.pi/SYSTEM.md` are
executable configuration. This repository already contains `.pi/prompts` (Spec Kit templates that are
irrelevant to the remote agent) and will grow. Loading them would mean that anything merged into
`.pi/` later silently changes what the unattended agent does — and the agent runs with a model
provider key. Keeping the runner's configuration explicit and outside the trust-gated set makes
behaviour a function of one reviewed Markdown file plus one argument list.

**Alternatives considered**:
- *`.pi/APPEND_SYSTEM.md` plus `--approve`*: the idiomatic Pi-native layout and tempting for
  familiarity, but it makes the agent's behaviour depend on trust-gated content that other features
  will also edit, and it re-enables extension loading in a credential-bearing job. Rejected.
- *Baking instructions into the workflow YAML*: the instructions change far more often than the
  pipeline, and reviewers would have to read YAML to review behaviour.
- *Relying on `AGENTS.md`*: useful and kept as ordinary context, but it is a repository-development
  document; the remote agent needs instructions that speak about issue-driven operation (thread
  etiquette, command handling, English artifact rule).

---

## D4 — Trigger and state representation

**Decision**: A set of `agent:*` labels is the state machine; the `issues.labeled` event with the
start label is the trigger; a platform `concurrency` group keyed on the issue number serialises runs.

**Rationale**: Labels are the only repository-native, permission-gated, instantly visible
(non-comment) state channel, and they satisfy FR-003 (explicit marking), FR-010 (visible state), and
FR-022 (same mechanism for new and existing issues) with one artifact. The concurrency group with
`cancel-in-progress: false` gives per-issue serialisation (FR-013) without any lock service: the
platform will not run two jobs in the same group.

**Alternatives considered**:
- *Command word in a comment as the start signal*: discoverable but leaves the issue list showing
  nothing about which issues are being worked on, and conflates "start" with "decide".
- *Assignment to a bot account*: requires a second identity and does not express state.
- *External state store (database, KV)*: contradicts the spec's decision that the repository is the
  record, and adds a dependency with its own failure modes.

**Risk accepted**: labels are mutable by anyone with write access, who can also legitimately drive
the agent, so no privilege is gained — but a human relabelling mid-run is reconciled by the run's
own record rather than trusted blindly.

---

## D5 — Continuity between runs

**Decision**: Best-effort Pi session continuity through a per-issue session file cached with the
platform cache action, keyed on the issue number, with the thread as the fallback context.

**Rationale**: SC-013 requires that a resumed run does not repeat finished steps. Pi can resume a
session by ID, which preserves the full working context cheaply. But caches are evictable, so the
thread must be able to stand alone: the orchestrator always builds a thread digest (request text,
prior feedback comments, decisions, proposal links) and injects it when no session is restored. The
thread remains the record (per the spec's clarification), the session is an optimisation.

**Alternatives considered**:
- *Thread-only reconstruction*: always works, always re-derives context, and a long issue burns
  tokens re-reading its own history. Kept as the fallback rather than the primary path.
- *Persisting sessions as committed files*: rejected by the spec's clarification that no per-run
  record files are committed for their own sake.
- *Artifact-based session passing*: workflow artifacts are not designed for cross-run input and
  expire; the cache API is the supported mechanism.

---

## D6 — Consumption limit enforcement

**Decision**: The orchestrator calls `get_session_stats` after every turn, posts a warning at a
configurable soft threshold (`warnAtRatio`, default 0.8), and at the hard limit aborts at the next
boundary, posts the consumed amount, and requires an explicit `continue` command which raises that
issue's allowance by one configurable increment.

**Rationale**: FR-017 wants a stop *and* an explicit decision, not a silent kill. Pi reports
cumulative cost and tokens itself, so the number is the harness's own accounting rather than an
estimate. Measuring per turn (not per job) means the limit applies to the conversation, so resumed
runs keep counting instead of resetting.

**Alternatives considered**:
- *Wall-clock timeout only*: bounds duration, not spend; a slow model can burn far more than a fast
  one in the same minutes.
- *Provider-side budget keys*: coarse, per-key rather than per-issue, and would hide the number from
  the thread that the spec says must carry it.
- *Counting turns*: a weak proxy — turn cost varies by an order of magnitude.

---

## D7 — Retry semantics

**Decision**: No retries at either layer: the orchestrator never retries a run, and Pi's own
transient-error retry is switched off for these sessions.

**Rationale**: The spec's clarification is "no automatic retry", and its stated purpose is that "a
failure never silently multiplies consumption". Pi's automatic retry would do exactly that, invisibly,
inside a run that the thread reports as a single attempt. Turning it off makes the recorded cost and
the recorded attempt count truthful. The cost of the stricter reading is that a transient provider
error becomes a failed run needing one command word from a human — acceptable, and visible.

**Alternatives considered**:
- *Leave Pi's auto-retry on, disable only run-level retry*: arguably "different layer", but it
  contradicts the spirit of the clarification and hides attempts.
- *One retry for transient errors*: this was the recommendation at clarification time and was
  explicitly declined by the product owner.

**Consequence to document for users**: failed runs may be retried with `/agent retry`, which starts a
new run continuing the recorded state, and the thread shows the sequence of attempts (FR-032).

---

## D8 — Repository authentication

**Decision**: The job uses the platform-provided workflow token, with the smallest permission set
that satisfies the feature (`issues: write`, `contents: write`, `pull_requests: write`), and the
token exists **only in the orchestrator's process environment** — never in Pi's.

**Rationale**: FR-021 asks for credentials limited to what the workflow needs and not tied to an
individual. The workflow token is short-lived, scoped to the repository, and revoked with the job.
The separation from Pi is what makes the spec's prompt-injection rule (FR-029) enforceable rather
than aspirational: there is no repository credential inside the agent process to leak, and no ability
to push, comment, or merge from inside a tool call.

**Alternatives considered**:
- *GitHub App installation token*: more granular and independent of workflow runs, and the right
  move if the workflow later spans repositories or needs to act on behalf of a bot identity.
  Deferred, not rejected — it is a drop-in replacement inside `github.js`.
- *Personal access token*: violates FR-021 (tied to an individual) and never expires soon enough.

---

## D9 — GitHub API access from the orchestrator

**Decision**: A thin internal REST client over the Node built-in `fetch`, covering only the ten or so
endpoints the feature uses.

**Rationale**: The runner is a credential-bearing process in a repository that receives untrusted
text. Every runtime dependency is another supply-chain path into that process. Node 22 ships `fetch`,
so the client is a few hundred lines with explicit request shaping, and it is unit-testable against
recorded responses. `@octokit/rest` remains the obvious replacement if the endpoint surface grows.

**Alternatives considered**:
- *`@octokit/rest`*: ergonomic, typed, and the default choice for larger surfaces; rejected here for
  dependency minimalism in a security-sensitive process, not on capability.
- *Shelling out to `gh`*: preinstalled on runners, but string-building shell commands around
  untrusted issue content is a worse injection surface than structured JSON requests.

---

## D10 — Secret handling

**Decision**: Two layers. (a) Pi's environment contains the model provider key and nothing else;
Pi's tools cannot reach repository credentials because those live in the orchestrator. (b) Everything
the orchestrator posts or commits passes through a redaction step that rejects values matching known
credential shapes and known job secrets.

**Rationale**: FR-018 and SC-010 need "no secret appears in thread or committed content". Layer (a)
removes the opportunity; layer (b) catches the accident (a maintainer pastes a token into an issue and
the agent thoughtfully repeats it in a summary). Redaction runs on the way out, not on the way in, so
it cannot silently alter the agent's understanding of the request.

**Alternatives considered**:
- *Redaction only*: a denylist against an adversarial model is not a boundary.
- *Removing the credential from the environment only*: does not stop the pasted-key accident.

---

## D11 — Proposal creation

**Decision**: The orchestrator commits and pushes the agent's file changes to a branch named
`agent/<issue-number>-<slug>` and opens a pull request linked to the issue, with the issue-thread
result comment pointing at it. Pi never pushes and never contacts the forge.

**Rationale**: FR-007 and FR-008 require a reviewable proposal and no self-merge. Keeping git
operations in the orchestrator means the agent's output is a filesystem diff that the orchestrator
inspects, redacts, commits with a fixed English message, and publishes — one auditable step between
model output and repository history. It also makes the "no credentials in Pi" decision workable.

**Alternatives considered**:
- *Letting Pi run `git` and `gh` itself with credentials*: more flexible (multiple commits, branch
  switching), but puts repository authority inside the process that hostile issue text can steer.
- *Patch files attached to comments*: no branch, no review UI, and reviewers lose inline diff review.

---

## D12 — Model and version pinning

**Decision**: Pin the Pi package to an exact version and pin the model ID in `.agent/config.yml`.
Both are reviewable content.

**Rationale**: An unattended agent whose behaviour changes silently because a floating dependency
updated is not auditable, and SC-005 (third-party reconstruction) assumes the record means the same
thing later. Pinning makes an upgrade a reviewable change, which is exactly what the constitution's
review expectation wants for behaviour-affecting changes.

**Alternatives considered**: floating minor/patch ranges (rejected: silent behaviour drift); model
alias instead of an exact ID (rejected: aliases move).

---

## Open items carried into Phase 1 (not clarifications, resolved here)

- **Acknowledgement latency**: SC-002's two minutes is met by making the acknowledgement the first
  action of the run job. If platform queue latency exceeds it, the concurrency group and a separate
  lightweight acknowledgement job are the fallback levers. Documented in `contracts/labels.md`
  invariants and `quickstart.md`.
- **Rate limits**: the orchestrator treats a 403 with a rate-limit body as a retryable *orchestrator*
  condition (bounded, with backoff), not as a run retry — the spec forbids retrying the *run*, not
  the bookkeeping call.
- **Observability beyond the thread**: structured JSON logs on stderr per job, retained by the
  platform; no metrics pipeline. Deferred as plan-level, per the clarification report.
