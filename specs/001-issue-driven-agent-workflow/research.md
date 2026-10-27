# Research: Issue-Driven Agentic Workflow

**Feature**: `001-issue-driven-agent-workflow` | **Date**: 2026-10-26

All unknowns from the Technical Context are resolved below. Each entry states the decision, why it
was chosen, and what was rejected. Sources are the installed Pi 1.4.0 documentation under
`/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/`, the feature spec, and local
verification of the packaged entry points on 2026-10-27.

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
halt, then let the current turn finish, then send `abort`*. The timing is what enforces FR-027, not
`abort` itself: `abort` ends the current operation and only then waits for the session to become idle,
so sending it mid-turn would interrupt a tool call. Because `abort` also continues queued steering and
follow-up messages, the orchestrator verifies with `get_state` that both queues are empty before
aborting. Pi's own `steer` is deliberately not used for halts, because steering inserts an instruction
rather than ending the run.

---

## D3 — What Pi may load as configuration

**Decision**: Run Pi with project-trust-gated resources **disabled** (no auto-discovery of
extensions, skills, prompt templates, or MCP servers), an explicit instruction file
(`--append-system-prompt .agent/instructions.md`), an explicit tool allowlist
(`--tools read,bash,edit,write,grep,find,ls`), and — see D13 — prompt templates only from an
explicitly named allowlist.

**Rationale**: Pi's own documentation warns that project trust controls *which resources load*, not
what they may do: `.pi/extensions`, `.pi/settings.json`, `.pi/mcp.json`, and `.pi/SYSTEM.md` are
executable configuration. This repository already contains `.pi/prompts` and will grow. Auto-discovery
would mean that anything merged into `.pi/` later silently changes what the unattended agent does —
and the agent runs with a model provider key. Keeping the runner's configuration explicit makes
behaviour a function of one reviewed Markdown file plus one argument list, whatever a branch happens
to contain.

**Alternatives considered**:
- *`.pi/APPEND_SYSTEM.md` plus `--approve`*: the idiomatic Pi-native layout and tempting for
  familiarity, but it makes the agent's behaviour depend on trust-gated content that other features
  will also edit, and it re-enables extension loading in a credential-bearing job. Rejected.
- *Baking instructions into the workflow YAML*: the instructions change far more often than the
  pipeline, and reviewers would have to read YAML to review behaviour.
- *Relying on `AGENTS.md`*: useful and kept as ordinary context, but it is a repository-development
  document; the remote agent needs instructions that speak about issue-driven operation (thread
  etiquette, command handling, English artifact rule).

**Revision after a direct question about `.pi/prompts`**: refusing *auto-discovery* of prompt
templates is not the same as refusing the templates themselves. Templates are text, not executable
configuration — the argument that rules out `.pi/extensions` does not apply to them — and the
repository's Spec Kit templates are exactly the kind of reusable workflow a remote agent should be
able to follow. D13 records the narrower rule that follows: named templates load, discovered ones
never do.

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
platform cache action, keyed on the issue number **and a configuration fingerprint**, with the thread
as the fallback context.

**Rationale**: SC-013 requires that a resumed run does not repeat finished steps. Pi can resume a
session by ID, which preserves the full working context cheaply. But caches are evictable, so the
thread must be able to stand alone: the orchestrator always builds a thread digest (request text,
prior feedback comments, decisions, proposal links) and injects it when no session is restored. The
thread remains the record (per the spec's clarification), the session is an optimisation.

**Fingerprint requirement (added after the consistency review)**: Pi persists the system-prompt
sections and the tool declarations inside the session file, so a resumed session can replay an older
instruction file and an older tool allowlist. The fingerprint covers the instructions hash, `model`,
`thinking`, `tools`, and `promptTemplates`; it is part of the session id and the cache key, and a run
asserts the effective tool list and model through `get_state` before the first prompt. The pinned Pi
version was added to the same fingerprint by the 2026-10-27 amendment (D16), so a harness upgrade also
starts a fresh session. Without this,
FR-014 ("apply the currently committed version to new work only") would be violated by the very
mechanism that provides continuity (finding F7 in `consistency-and-decision-review.md`).

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

**Session accounting (decision after the consistency review)**: Pi reports session-lifetime totals, and a
session ends when the configuration fingerprint changes or the cache is lost — so a single cumulative
number could be reset by an eviction. Each session is therefore documented separately in the issue as an
`agent:session` message, and the per-issue total the limit applies to is the sum of those documented
sessions. That keeps the limit effective across cache loss and makes the spending visible per session
rather than as one opaque figure.

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

**Enforcement completed (decision after the consistency review)**: `set_auto_retry` alone covered only
transient provider errors, while Pi also performs context-overflow recovery and compaction retries that
emit `summarization_retry_scheduled` and set `willRetry`. The maintainer chose the strict reading, so the
contract now closes the gap in two steps: `set_auto_compaction {enabled: false}` removes proactive
compaction and the retry it triggers, and any remaining retry signal (`auto_retry_*`,
`summarization_retry_*`, `compaction_*`, `willRetry`) aborts the run and fails it with
`unexpected-retry`. The cost of the strict rule is unchanged and accepted: a long run that would have
compacted now fails and needs one command word from a human, which is exactly what "no silent
multiplication of consumption" asks for (finding F19, now closed).

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
  Deferred, not rejected — it is a drop-in replacement inside `github.ts`.
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

**Decision**: Three layers. (a) Pi's environment contains the model provider key and nothing else;
Pi's tools cannot reach repository credentials because those live in the orchestrator. (b) Everything
the orchestrator posts or commits passes through a redaction step that rejects values matching known
credential shapes and known job secrets. (c) The checkout is made with `persist-credentials: false`, so
no repository token is written into `.git/config` where the agent's `bash` tool could read it.

**Rationale**: FR-018 and SC-010 need "no secret appears in thread or committed content". Layer (a)
removes the opportunity; layer (b) catches the accident (a maintainer pastes a token into an issue and
the agent thoughtfully repeats it in a summary). Redaction runs on the way out, not on the way in, so
it cannot silently alter the agent's understanding of the request.

Layer (c) closes a gap that (a) alone leaves open: Pi has a `bash` tool, and the default checkout
configures the git remote with the workflow token embedded. "The orchestrator owns git" is only true if
the agent's shell finds no credential to use. The orchestrator therefore pushes with a short-lived,
per-job credential it adds at push time and removes afterwards, and a unit test asserts the workspace
git config contains no token before Pi starts.

**Egress restriction (decision after the consistency review)**: `bash` has full network access, and Pi
legitimately holds the provider key, so a hostile instruction could exfiltrate the key or the checkout —
a risk FR-018 and SC-010 do not cover, because they speak only of the thread and committed content. The
maintainer chose to close it rather than document it: the job applies an egress allowlist containing only
the model provider endpoint (from `network.allowHosts`) before Pi starts, Pi runs with `--offline`, and a
run whose restriction cannot be applied fails with `environment` instead of starting (FR-034). The
provider key stays in the agent's environment, but it has nowhere to send it.

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

The same ownership covers the end of the proposal's life: the orchestrator observes
`pull_request.closed`, records whether the change was merged and by whom, and resolves the issue to
`finished` or `rejected` (FR-033). An approving or changes-requested review counts as `approve` or
`reject` and is mirrored into the thread, because branch protection requires a review anyway and the
thread must not contradict the pull request.

**Alternatives considered**:
- *Letting Pi run `git` and `gh` itself with credentials*: more flexible (multiple commits, branch
  switching), but puts repository authority inside the process that hostile issue text can steer.
- *Patch files attached to comments*: no branch, no review UI, and reviewers lose inline diff review.
- *Leaving the issue in `waiting` after the merge*: keeps the agent out of the merge path entirely, but
  then no issue ever reaches a terminal state and SC-003 becomes unmeasurable.

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

## D13 — Spec Kit prompt templates as an agent capability

**Decision**: Load prompt templates only from an **explicit allowlist** in `.agent/config.yml`
(`promptTemplates:`), passed as repeated `--prompt-template <path>` arguments resolved on the trusted
checkout. The default allowlist is the three-step development loop — `.pi/prompts/speckit.specify.md`,
`speckit.plan.md`, `speckit.tasks.md` — listed explicitly, not as a glob: a glob would silently admit
every template the repository ever gains, including `/speckit.analyze`, which is not part of this
workflow's vocabulary.
Auto-discovery stays off (`--no-prompt-templates`).

**Rationale**: "The Spec Kit prompts are irrelevant to the agent's own behaviour — but could I still
use them?" separates two different things, and only one of them is true. *Discovery* must stay
refused, because it lets arbitrary branch content add slash commands behind a reviewer's back.
*Referencing* a named template is a different act: it loads Markdown instructions from a path a
reviewer sees in a config diff, it is not executable, and Pi expands it before the text enters the
agent, so `$ARGUMENTS` and `${1:-default}` substitution work exactly as they do locally.

This buys a pleasing symmetry: a feature-sized issue becomes a Spec Kit run
(`specify` → `plan` → `tasks`) whose artifacts are part of the proposal — this repository's own
development loop, triggered from an issue instead of a terminal.

Three properties make it safe here, verified rather than assumed:
1. **Templates are inert.** They produce prompts, not tool registrations. The worst a bad template can
   do is add instructions — and trust in reviewed repository instructions is already the model for
   `.agent/instructions.md`.
2. **Spec Kit performs no git operations in this repository.** `grep -rn "\bgit\b" .specify/scripts/bash/*.sh`
   returns only two comment lines in `common.sh` (37, 78) that mention a hook extension which does not
   exist; no script invokes git. `create-new-feature.sh` computes a branch *name* and creates a
   directory, but never switches, commits, or pushes. Branch creation is a hook responsibility
   (`.specify/extensions.yml`), which does not exist here. A remote agent driving Spec Kit therefore
   cannot fight the orchestrator for control of git state.
3. **Artifacts land where they are reviewable.** Spec Kit writes `specs/**`, which the orchestrator
   commits into the proposal like any other change.

**Alternatives considered**:
- *Mention the template paths in `.agent/instructions.md` and let the agent `read` them*: no new flag,
  but it loses argument substitution and turns a defined command into ad-hoc interpretation. Kept as
  the fallback for a template the agent should inspect but not invoke.
- *Enable project prompt discovery (`--approve`) and rely on review*: rejected per D3 — it couples the
  agent's available commands to whatever the branch happens to contain.
- *Leave the templates unreachable*: honest but wasteful; the workflow vocabulary is already committed
  and reviewed, and re-deriving it in prose is how drift starts.

**Consequences to encode**:
- **Interactive steps become thread steps.** `/speckit.clarify`, `[NEEDS CLARIFICATION]` handling, and
  any hook prompt become a `waiting` state with a question comment, resumed by `/agent continue`. This
  maps onto the existing state machine without adding a state (`contracts/labels.md`).
- **The language rule still holds.** Spec Kit artifacts are committed content, so they must be English
  (constitution I). `.agent/instructions.md` repeats the rule for the remote context, because a
  non-English issue thread must not leak into `specs/**`.
- **Scope guard.** A Spec Kit run starts only when the issue is large enough to justify a spec; small
  fixes are made directly. Otherwise every typo spawns four documents and the spec's "request too
  large or too vague" edge case has to absorb the mess.
- **Bounded vocabulary.** The allowlist caps which commands exist for the agent, so its prompt surface
  cannot drift without a config diff.

---

## D14 — Reporting an ignored directive

**Decision**: the agent ends every answer with a machine-verifiable block — `agent-ignored:` followed by
one line per ignored directive, or the literal `agent-ignored: none`. The orchestrator parses it, redacts
it, and renders an `agent:notice` message.

**Rationale**: FR-030 and SC-014 need an observable signal. Free prose in the result comment cannot be
distinguished from an agent that stayed silent, so the security property would be unverifiable. A fixed
block turns it into something a test can assert, and it doubles as the first concrete use of the
"template not on the allowlist" case from D13.

**Consequence**: a missing or unparsable block is recorded in the thread as "no directive report was
produced" rather than failing the run. That is deliberately the softer of the two options: the report is
auditable either way, and failing every run whose model forgets a formatting rule would make the workflow
unusable. A directive the agent actually followed is a contract breach and is treated as a failure.

**Extended after the analysis pass**: the same mechanism carries two more reports, because FR-006
(ambiguity) and FR-014 (instruction that cannot be honoured) have the same problem — the orchestrator
cannot distinguish "silent" from "nothing to say". `agent-question:` drives the `waiting` state and
`agent-unmet:` feeds the notice without changing state. Both are optional; only `agent-ignored:` is
mandatory, so a model that forgets a block cannot stall a run.

**Alternatives considered**: free prose (unverifiable), a dedicated tool (needs an extension, which D3
forbids), post-hoc inspection of the model transcript (the orchestrator has no access to it).

## D15 — Implementation language

**Decision**: TypeScript 5.x, `strict` mode, ESM, compiled with `tsc` into `dist/`. Tests are TypeScript
as well and run from the build output (`node --test dist/tests`). `typescript` and `@types/node` are the
only development dependencies; `dist/` is git-ignored.

**Rationale**: this is an unattended process that holds a repository token, decides permissions, enforces
a spend limit, and builds commit messages — the code paths where a typo is expensive. Most of the domain
is small, explicit data: command words, label transitions, thread markers, a config schema, and RPC events
with documented shapes. TypeScript turns those into checked contracts instead of conventions, which is the
same argument the design already makes for labels, fixed command words, and a single config schema. It
also makes the RPC subset in `contracts/pi-rpc.md` enforceable: event and command payloads can be typed
against the documented shapes instead of being parsed by hand into `unknown`.

**Consequences to encode**:

- A build step exists: `npm ci` and `npm run build` run in the job before Pi starts. That costs a few
  seconds (cached by `setup-node`) and is a second thing that can fail — a build failure is reported as
  `environment`, not as an agent failure.
- Tests compile with the same `tsconfig`, so `node --test dist/tests` runs the shipped artifact. A
  separate test-only configuration would let tests pass against code that no longer type-checks.
- `dist/` never enters a commit, a diff, or a proposal. It is git-ignored and excluded from the diff
  collection, alongside session files.
- Strictness is a review rule, not a compiler flag alone: `noImplicitAny`, no `@ts-ignore` without a
  stated reason, and no `any` in exported signatures (research D8/D9 remain: only the Pi package is a
  runtime dependency).

**Alternatives considered**:

- *Plain JavaScript*: zero build step and the smallest possible surface, but no compile-time check on the
  permission gate, the state machine, or the RPC payloads, and refactors rely on grep. Rejected by the
  maintainer.
- *JavaScript with JSDoc types checked by `tsc --noEmit`* (the previous plan): keeps the no-build property
  and still type-checks, but the annotations live in comments, several constructs (generics over event
  unions, discriminated unions for states, `satisfies`) are awkward or impossible, and the checked types
  are not the ergonomic path, so they drift under time pressure.
- *TypeScript executed through a loader or transpiler at runtime (`tsx`, `ts-node`, `--experimental-strip-types`)*:
  removes the build step, but the process that runs then depends on a loader that can change behaviour
  between versions, and Node's type stripping is still experimental and rejects enums and namespaces. The
  strict build is the more predictable contract for an unattended job.
- *TypeScript with a bundler (esbuild, tsup)*: convenient single-file output, but adds a dependency and a
  second build configuration for a project of roughly twenty small modules. `tsc` is enough.

## D16 — Pi runtime provisioning (added 2026-10-27)

**Decision**: Resolve the Pi executable from the pinned dependency and launch it with
`process.execPath`. Specifically: resolve `@earendil-works/pi-coding-agent` through the ESM export map,
walk from the resolved module to the nearest `package.json`, read `bin.pi`, and execute that file with
the currently running Node binary. Assert before the first model call that the entry lives under
`<repoRoot>/node_modules/`, that the dependency spec is exact, that the installed version and the
`package-lock.json` version equal that spec, and that the entry is a readable, executable file. Pass the
resolved version to `agent:ack`; never hardcode it.

**Rationale**: The reported symptom — Pi is not available in GitHub Actions — is structural, not a
missing line in one workflow. `npm ci` creates `node_modules/.bin/pi`, but nothing puts that directory
on `PATH`, and the orchestrator spawns the bare word `pi`. That resolves on a developer machine with a
global install and fails on a clean runner with `ENOENT`. Resolving the package explicitly removes
`PATH`, the shell shebang, and the runner image from the equation; the version comes from the same
lockfile that `npm ci` consumed, so the running agent and the reviewed dependency cannot disagree.
Keeping `--mode rpc` in the arguments means the documented CLI invocation in `contracts/pi-rpc.md`
stays accurate. The same version is folded into the configuration fingerprint, so a Pi upgrade starts a
fresh session instead of resuming a session file written by an older harness.

Verified on 2026-10-27: with `PATH=/usr/bin:/bin`, `spawnSync("pi")` returns `ENOENT`, while
`node …/dist/bundle/rpc-entry.js --version` and `node …/dist/bundle/cli.js --version` both print
`1.4.0`. `npm install --ignore-scripts` still creates the `.bin/pi` symlink and the bundled CLI runs,
so the existing install step needs no change.

**Alternatives considered**:

- *Prepend `node_modules/.bin` to `PATH` in the workflow.* Minimal change, but the executable is then
  resolved by name, can be shadowed by a global install or a future runner image, and the version is
  not asserted at runtime. It also does not fix Blocker 2 (privilege handoff).
- *Install Pi globally in a setup step.* A second install outside the lockfile on the critical path,
  and two versions can coexist silently.
- *Use the `@earendil-works/pi-coding-agent/rpc-entry` export.* Public and one line shorter, but it
  hardcodes `--mode rpc`, so the launch contract would no longer show the documented command shape.
  Viable fallback if `bin.pi` ever stops being available.
- *Use the in-process SDK (`RpcClient`).* Removes the child process boundary, which is exactly the
  boundary that keeps the repository credential out of the agent process.

---

## D17 — Privilege handoff and workspace ownership (added 2026-10-27)

**Decision**: The job steps that can spawn Pi run the orchestrator through
`sudo --preserve-env=…`, preserving only non-secret values and invoking Node by absolute path. Secrets
travel in a mode-`0600` `AGENT_ENV_FILE` that root can read and the egress uid cannot; the orchestrator
reads it once and unlinks it before spawning Pi. The orchestrator asserts uid 0 when
`AGENT_EGRESS_UID` is set, then hands the work tree to the egress uid recursively, while the git
directory is moved out of the work tree into a root-owned mode-`0700` `GIT_DIR` and `node_modules/` stays
read-only. Ancestor directories are made traversable for the egress uid. Git runs with
`--git-dir`/`--work-tree`, `safe.directory`, `core.hooksPath=/dev/null`, and `--no-verify`; the push
token moves from argv to the git child's environment via `GIT_CONFIG_COUNT`. Pi is a process-group
leader; the group and any remaining process of the egress uid are killed before the diff is collected.

**Rationale**: The egress design needs `setuid`, which an unprivileged process cannot perform. The
current workflow applies the iptables policy with `sudo` but then runs the orchestrator as `runner`, so
`spawn(…, {uid: 1500})` fails with `EPERM` even after Pi is resolvable. Making the handoff explicit is
the smallest change that keeps FR-034 and the credential separation intact. A `.git` directory left in
the work tree is not enough: the egress uid owns the work-tree root, so it can delete or replace the
entry even if the directory itself is mode `0700`, and a replacement could carry a malicious
`core.fsmonitor` or hooks. Moving the git directory outside the work tree removes that path entirely;
hooks-disabled and `safe.directory` are defense in depth. Using an environment-carried credential
closes the leak path; the process group plus a uid-wide reap prevents an agent-started background
process from editing the tree during commit, even after `setsid`. Passing the secrets in a
root-readable file rather than through `sudo`'s environment avoids depending on the runner image's
`SETENV` policy and keeps them out of every argument list.

Verified constraints: the runner already grants passwordless `sudo`; `sudo` resets `PATH`, so Node
must be absolute; the egress user has no home, so `HOME`/`TMPDIR`/`XDG_CACHE_HOME` must be provided;
git's repository ownership check, hook execution, and `core.fsmonitor` are why the git directory is
kept outside the work tree; `safe.directory` and `core.hooksPath=/dev/null` are defense in depth. The
runner home is not guaranteed to be world-traversable.

**Alternatives considered**:

- *Run the orchestrator unprivileged and delegate spawning to a setuid helper.* Keeps the token out of
  root, but the helper is root-owned, so the unprivileged orchestrator cannot signal it for `abort`;
  forwarding signals from a root supervisor adds a new privileged IPC surface.
- *Apply egress to the runner uid and split GitHub access into a second job.* Breaks progress
  streaming, halt-at-boundary, and the single-writer thread rule.
- *Unprivileged user namespaces (`unshare -n`).* Not a guaranteed capability on `ubuntu-24.04` runners
  and fragile across image updates; fail-closed egress becomes best-effort.
- *Run Pi as the orchestrator's uid.* Same uid means the agent can read
  `/proc/<orchestrator>/environ` and obtain `GITHUB_TOKEN`.
- *Keep the token in `http.extraheader` argv.* Visible in `/proc/<pid>/cmdline` to any local user,
  including a surviving agent process; environment variables are owner-readable only.

---

## Open items carried into Phase 1 (not clarifications, resolved here)

- **Acknowledgement latency (decided)**: a first job that posts the acknowledgement before the run would
  only remove the same-issue serialization delay, not the platform's runner queue, which no in-Actions
  mechanism controls. The maintainer therefore chose to make the promise honest instead of adding a
  second writer: SC-002 is measured from the start of the run, and every acknowledgement prints the
  queue delay, which makes queue latency a visible, reviewable number (SC-016). This also means
  the design does not need a second job that writes to the thread, and its idempotency marker stays
  single-owner.
- **Rate limits**: the orchestrator treats a 403 with a rate-limit body as a retryable *orchestrator*
  condition (bounded, with backoff), not as a run retry — the spec forbids retrying the *run*, not
  the bookkeeping call.
- **Observability beyond the thread**: structured JSON logs on stderr per job, retained by the
  platform; no metrics pipeline. Deferred as plan-level, per the clarification report.
