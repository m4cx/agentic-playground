# Contract: Configuration

**Feature**: `001-issue-agent-sessions` | **Version**: 1

Two reviewed repository files define how the agent runs. They are the only place provider or trigger
details are named. The loader (`src/agent/config.ts`) validates both before any model call and fails
closed on an unknown key, a missing key, or an out-of-range value. Both files are read from the
**current default-branch commit**, not from the feature branch under work, so a session cannot change
its own behaviour.

## `.agent/config.json`

```json
{
  "version": 1,
  "triggerLabel": "agent:run",
  "resumeCommand": "/agent continue",
  "slugMaxLength": 50,
  "maxComments": 100,
  "maxCommentCharacters": 8000,
  "model": "ollama-cloud/kimi-k2.7-code",
  "thinking": "high",
  "tools": ["read", "bash", "edit", "write", "grep", "find", "ls"],
  "instructionsPath": ".agent/instructions.md",
  "agentDeadlineMinutes": 45,
  "network": {
    "allowHosts": ["ollama.com", "registry.npmjs.org"]
  }
}
```

### Field rules

| Field | Type | Default | Validation |
|-------|------|---------|------------|
| `version` | integer | required | exactly `1` |
| `triggerLabel` | string | `agent:run` | matches `^[A-Za-z0-9][A-Za-z0-9:_-]{0,49}$`; must equal the label filter in `agent-run.yml` (contract test) |
| `resumeCommand` | string | `/agent continue` | starts with `/`, no newline, 1..40 characters; must equal the comment filter in `agent-resume.yml` (contract test) |
| `slugMaxLength` | integer | `50` | 1..50 |
| `maxComments` | integer | `100` | 1..500 |
| `maxCommentCharacters` | integer | `8000` | 500..50000 |
| `model` | string | required | `provider/model` present in `.agent/models.json`; model id non-empty |
| `thinking` | string | `high` | one of `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| `tools` | string[] | required | non-empty subset of `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`; no duplicates |
| `instructionsPath` | string | `.agent/instructions.md` | repository-relative path, no `..`, file exists, ≤ 100 KB |
| `agentDeadlineMinutes` | integer | `45` | 5..120 and lower than the workflow job timeout |
| `network.allowHosts` | string[] | required | non-empty, unique, valid DNS names; must include the host of the configured provider `baseUrl` |

Unknown keys at any level are rejected. The parsed configuration is frozen and its SHA-256 hash is
part of the session fingerprint.

### Why these values

- The trigger label and resume command are mirrored in the workflow filters because GitHub Actions
  cannot read a repository file in its `if:` expression without starting the job. The contract test is
  the guard against drift.
- `slugMaxLength` may be reduced, but never raised above 50, so the branch name stays predictable and
  within the spec.
- `agentDeadlineMinutes` is lower than the 60-minute job timeout; the orchestrator needs time to
  commit, push, open the PR, and comment after the agent stops.
- `network.allowHosts` is the allowlist for the egress script. If the provider host is missing, the
  agent cannot reach the model and the run fails closed with `environment`.

## `.agent/models.json`

```json
{
  "$schema": "https://pi.dev/schemas/models.schema.json",
  "providers": {
    "ollama-cloud": {
      "name": "Ollama Cloud",
      "baseUrl": "https://ollama.com/v1",
      "api": "openai-completions",
      "apiKey": "$OLLAMA_API_KEY",
      "models": [
        {
          "id": "kimi-k2.7-code",
          "name": "Kimi K2.7 Code (Ollama Cloud)",
          "reasoning": true,
          "input": ["text", "image"]
        }
      ]
    }
  }
}
```

**Rules**:

- The file is passed to Pi by placing it in the agent config directory used for the run
  (`PI_CODING_AGENT_DIR`), not by relying on the user's global Pi configuration.
- `apiKey` must be an environment reference (`$NAME`), never a literal secret.
- The provider `baseUrl` host must appear in `network.allowHosts`.
- The model referenced by `config.model` must exist in this file.
- Changing the file changes the configuration fingerprint and therefore starts a fresh Pi session on
  the next run.

## Environment

| Variable | Source | Visibility |
|----------|--------|------------|
| `GITHUB_TOKEN` | job token | orchestrator only; never passed to Pi |
| `PR_TOKEN` | optional repository secret | orchestrator only; used only for pull-request creation when the job token is not permitted to create PRs |
| `OLLAMA_API_KEY` | repository secret | passed to Pi so it can reach the model endpoint; never written to a comment or commit |
| `PI_CODING_AGENT_DIR` | job setup | Pi process only; points at a run-local directory containing the reviewed `models.json` |
| `PI_CODING_AGENT_SESSION_DIR` | job setup | Pi process only; points at the cached session directory |
| `AGENT_ALLOW_HOSTS` | config | egress script only |

The orchestrator builds the Pi environment explicitly and does not inherit the job environment
wholesale. `GITHUB_TOKEN` and `ACTIONS_*` variables are removed. The provider key is the only secret
the agent process receives.

## Workflow mirroring

The only duplicated values are:

| Value | `.agent/config.json` | Workflow |
|-------|----------------------|----------|
| Trigger label | `triggerLabel` | `agent-run.yml` `if:` filter |
| Resume command | `resumeCommand` | `agent-resume.yml` `if:` filter |

`tests/contract/workflow-config.test.ts` parses both YAML files as text (no YAML dependency) and
asserts the values match. A mismatch fails CI. Everything else is read from the config at run time.

## Configuration change behavior

1. A change to `config.json`, `models.json`, `instructions.md`, the tool list, the model, or the Pi
   version changes the fingerprint.
2. The next run starts a new Pi session ID (`issue-<n>-<fingerprint8>`) and records the previous
   session ID in the state history.
3. The branch, slug, and issue-session identity do not change.
4. A change applies only to new runs; a run already in flight keeps the configuration it started with.
