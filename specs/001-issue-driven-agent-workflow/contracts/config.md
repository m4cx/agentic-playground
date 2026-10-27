# Contract: Agent Configuration (`.agent/config.yml`)

**Feature**: `001-issue-driven-agent-workflow` | **Requirements**: FR-014, FR-017, FR-021, FR-026,
FR-031

This is the single schema for the agent's behaviour configuration. Every other artifact — `plan.md`,
`data-model.md`, `contracts/commands.md`, `contracts/pi-rpc.md`, `contracts/proposal.md`,
`quickstart.md` — refers to the keys defined here instead of inventing its own. Adding a key to any
other document without adding it here is a contract violation.

## Rules

1. **Location**: `.agent/config.yml` on the committed default branch. It is loaded from the checkout of
   the trusted ref, never from a branch the agent created (FR-014).
2. **Reviewability**: the file is repository content, so changes are reviewable diffs and take effect
   for new runs only (FR-014).
3. **Fail closed**: an unknown key, a missing required key, or a value outside its stated range fails the
   run before any model call, with failure enum `environment` and a thread message naming the key. A
   configuration error never degrades silently into a default.
4. **Secrets are not configuration**: no key in this file may hold a credential. The provider API key is
   the only secret the agent job exposes, and it comes from repository secrets (FR-021). The model and
   thinking level are configuration, not secrets, so they are reviewable.
5. **Fingerprint**: the values of `model`, `thinking`, `tools`, and `promptTemplates`, the hash of
   `.agent/instructions.md`, and the pinned Pi version (from `package-lock.json`) form the run's
   configuration fingerprint. It is recorded per run and used in the session-continuity key
   (`contracts/pi-rpc.md` §"Continuity"). Including the Pi version means an upgrade starts a fresh
   session instead of resuming one written by an older Pi.
6. **Session accounting**: consumption is recorded per session (`agent:session`) and the per-issue limit
   applies to their sum (`contracts/pi-rpc.md` §"Session accounting"). Configuration does not restate
   that rule; it only supplies the limit.
7. **Egress**: `network.allowHosts` is applied as an allowlist before Pi starts. It must name every host
   the provider needs (authentication and inference) and nothing else, so a token refresh cannot fail
   while a foreign host stays reachable. An empty list, a missing provider host, or a failure to apply the
   restriction fails the run with `environment` and no model call happens (FR-034).
8. **Sweep window**: `sweep.graceMinutes` is the only definition of "stuck". The reconciler uses it
   directly; a run that legitimately exceeds it is indistinguishable from a dead one, so it must be
   comfortably larger than `limits.maxWallClockMinutes`.
9. **Pi runtime version is not a config key**: the Pi version has exactly one home, the exact
   dependency pin in `package.json` plus `package-lock.json`. The orchestrator resolves the installed
   package, asserts the installed and locked versions equal the pin, and records the resolved version
   in `agent:ack` (`contracts/pi-rpc.md` §"Runtime preconditions", research D16). Duplicating it here
   would create a second value that can disagree with what `npm ci` actually installed.

## Schema

| Key | Type | Required | Range / values | Used by |
|-----|------|----------|----------------|---------|
| `model` | string | yes | exact model ID accepted by the pinned Pi version | `--model` (research D12) |
| `thinking` | enum | yes | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` | `--thinking` |
| `tools` | list of tool names | yes | subset of the built-in set; must never contain a forge or git credential-bearing tool | `--tools` (research D10) |
| `promptTemplates` | list of repository-relative paths | yes | each path must exist on the trusted ref and end in `.md`; empty list is valid | repeated `--prompt-template` (research D13) |
| `instructionsPath` | path | yes | `.agent/instructions.md` | `--append-system-prompt` |
| `labels` | map | yes | `request`, `queued`, `working`, `waiting`, `halted`, `finished`, `failed`, `rejected`, `proposal` | `contracts/labels.md` |
| `globalHaltIssue` | integer | yes | number of the issue whose `/agent halt` applies repository-wide | `contracts/commands.md` §6 |
| `limits.maxCostUsd` | number | yes | `> 0` | FR-017 (research D6) |
| `limits.warnAtRatio` | number | yes | `0 < r < 1` (documented default 0.8) | soft warning |
| `limits.continueIncrementUsd` | number | yes | `> 0` | `/agent continue` allowance raise |
| `limits.maxTurns` | integer | yes | `> 0` | hard stop regardless of cost |
| `limits.maxWallClockMinutes` | integer | yes | `> 0`, well below the platform job ceiling | job timeout (research D1) |
| `limits.startDeadlineSeconds` | integer | yes | `> 0` | no first response within the deadline → `environment` |
| `proposal.maxChangedPaths` | integer | yes | `> 0` | bounded diff (`contracts/proposal.md`) |
| `proposal.maxDiffLines` | integer | yes | `> 0` | bounded diff (`contracts/proposal.md`) |
| `continuity.sessionCacheKeyPrefix` | string | yes | `pi-session` | session cache key (research D5) |
| `network.allowHosts` | list of host names | yes | every host the configured provider needs for authentication **and** inference, and nothing else | egress restriction applied before Pi starts (FR-034) |
| `sweep.graceMinutes` | integer | yes | `> 0`; how long an issue may hold `agent:working` before the reconciler treats it as interrupted | `src/agent/reconcile.ts` (invariant I5) |

## Relationship to the environment

| Value | Source | Reason |
|-------|--------|--------|
| Provider API key | repository secret, injected into Pi's environment only | the only credential Pi needs |
| `GITHUB_TOKEN` | workflow job, orchestrator process only, never exported to Pi | FR-021, research D10 |
| Pi executable and version | resolved from `node_modules/` using the package export map; asserted against the exact pin | Not from `PATH`, not from a global install (research D16) |
| Orchestrator privilege | the workflow's explicit `sudo` handoff on Pi-spawning modes | Required to start Pi under the egress uid (research D17) |
| Everything behaviour-related | `.agent/config.yml` + `.agent/instructions.md` | one reviewable surface (research D3) |

There is deliberately **no** environment variable that overrides `model`, `thinking`, `tools`, or
`promptTemplates`. An earlier draft passed `AGENT_MODEL` and `AGENT_THINKING` from secrets, which made
behaviour invisible in review; that is removed. If a canary override is wanted later, it must be added
here as a key with a stated precedence, not as an undocumented environment variable.

## Validation examples (test contract)

| Case | Expected |
|------|----------|
| `promptTemplates` contains a path that does not exist on the trusted ref | config validation fails before any model call; failure enum `environment` |
| `promptTemplates` contains a path outside the repository | validation fails |
| `limits.warnAtRatio` is `0` or `1` | validation fails |
| `tools` includes an unknown name | validation fails |
| The Pi dependency is a range, or the installed version differs from the pin | the run fails with `environment` before any model call (this is a runtime precondition, not config validation) |
| `labels.request` collides with a state label | validation fails |
| File is missing or unparsable | run fails with `environment`; the thread names the file, not a stack trace |
