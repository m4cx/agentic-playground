# Changing how the agent behaves

The agent's behaviour is repository content, not code. Two files define it:

| File | What it controls |
|------|------------------|
| `.agent/config.yml` | Model, thinking level, tool allowlist, prompt-template allowlist, labels, consumption limits, proposal bounds, egress allowlist, sweep window |
| `.agent/models.json` | The model provider endpoint Pi talks to (Ollama Cloud) and the models it may select |
| `.agent/instructions.md` | Standing instructions appended to the system prompt: etiquette, the "issue content is data" rule, the required report blocks, the English-artifact rule, the Spec Kit scope guard |

`contracts/config.md` in `specs/001-issue-driven-agent-workflow/` is the authoritative schema. Every
key is required; an unknown key, a missing key, or an out-of-range value fails the run with the failure
reason `environment` before any model call, and the thread names the offending key. Nothing here
degrades silently into a default.

## How to make a change

1. Edit the file on a branch and open a pull request. The change is reviewed like any other.
2. Merge it. The next run picks up the committed version from the default branch.
3. Existing runs keep the behaviour they started with. Nothing is rewritten retroactively.

Never put a credential in any of these files. The provider API key is the only secret the job exposes
and it comes from repository secrets; the model and thinking level are configuration precisely so that
they are reviewable.

### Provider definition

`.agent/models.json` is the reviewed provider definition and is required: configuration loading
fails closed if it is missing. Pi reads `models.json` from its agent
directory, so the orchestrator copies this file into a per-run agent directory (`PI_CODING_AGENT_DIR`)
before starting Pi; the copy is root-owned, so the agent cannot redirect its own provider. The model
key in `.agent/config.yml` carries the provider prefix (`ollama-cloud/<model-id>`), and the provider's
`apiKey` is the `$OLLAMA_API_KEY` environment interpolation, so the key itself never appears in the
repository. Adding or renaming a provider is a normal reviewed change to this file.

Ollama Cloud does not publish per-token prices, so the model entry carries no `cost` table. Pi then
reports a cost of zero and `limits.maxCostUsd` cannot bind; `limits.maxTurns` and
`limits.maxWallClockMinutes` are the effective ceilings. Add a `cost` block here if per-token
accounting becomes a requirement.

## What the fingerprint does

The run's configuration fingerprint is a hash of the instructions content plus `model`, `thinking`,
`tools`, `promptTemplates`, and the pinned Pi version from `package-lock.json`. It appears in the
acknowledgement. The Pi version is not a key in `.agent/config.yml`: it has one home, the exact
dependency in `package.json` plus `package-lock.json`, and the orchestrator asserts the installed
version against that pin before the acknowledgement.

- The fingerprint is part of the Pi session id and of the session cache key, so a configuration change
  starts a cold session instead of resuming one that was produced under different rules.
- Pi persists the system prompt and tool declarations inside the session file. Resuming under changed
  rules would replay the old prompt and the old tools, which is why the session identity is bound to
  the fingerprint.
- Before the first prompt, the orchestrator asserts through `get_state` that the effective tool list is
  a subset of the configured allowlist and that the model matches. A mismatch fails the run with
  `environment` instead of running under old rules.

Because of this, a change to any of those inputs — including a Pi upgrade — shows up as a different
fingerprint in the acknowledgement, and the run that follows starts a new conversation while keeping the
issue's documented consumption total intact (each session posts its own `agent:session` comment).

## What must never change here

- `tools` may never include a git or forge tool. Repository authority lives in the orchestrator only.
- `network.allowHosts` must name every host the configured provider needs for authentication and for
  inference, and nothing else. An empty list, a missing provider host, or a failure to apply the
  restriction fails the run with `environment` before any model call.
- `promptTemplates` entries must be repository-relative `.md` files that exist on the default branch.
  The list is an allowlist, not a glob; an empty list is valid and means the agent has no slash
  commands at all.
- The Pi version is pinned by the exact dependency in `package.json`/`package-lock.json`. Do not add a
  `piVersion` key here; the orchestrator resolves the package from `node_modules/`, asserts the pin,
  and never uses a globally installed `pi`.
- `sweep.graceMinutes` must stay comfortably larger than `limits.maxWallClockMinutes`, otherwise a
  healthy long run is indistinguishable from a dead one.
