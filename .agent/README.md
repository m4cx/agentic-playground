# Agent configuration

This directory is the reviewed behaviour surface of the issue-driven coding agent.

| File | Purpose |
|------|---------|
| `config.json` | Trigger label, resume command, model, thinking level, tools, deadlines, and network allowlist |
| `models.json` | Pi provider endpoint and model definition |
| `instructions.md` | Standing instructions appended to Pi's system prompt |

## Changing behaviour

1. Edit the file in a pull request and describe the intended effect.
2. A maintainer reviews and merges it.
3. The next agent run reads the file from the default branch and computes a new configuration
   fingerprint. A changed fingerprint starts a fresh Pi session; the issue, slug, and branch stay the
   same.

The workflow filters in `.github/workflows/agent-run.yml` and `agent-resume.yml` mirror the
`triggerLabel` and `resumeCommand` values. `tests/contract/workflow-config.test.ts` fails CI when they
diverge, so change both in the same pull request.

## Secrets

`OLLAMA_API_KEY` is a repository secret used only by the Pi child process. The GitHub token is never
passed to the agent. The egress allowlist in `config.json` must contain the host of the provider
`baseUrl` in `models.json`, or the run fails closed before the model call.
