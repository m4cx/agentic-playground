# agentic-playground

I want to test out multiple approaches how to create a completely remote setup for an agentic software engineering lifecycle.

## Issue-driven coding agent

The first approach turns a GitHub issue into one coding-agent session. A person with write access
labels an issue with `agent:run`; the agent works the issue, commits the result to
`feature/<issue-id>-<issue-slug>`, opens a pull request, and reports back in the issue thread. A human
reviews and merges. One issue equals one session; follow-up work resumes the same session with
`/agent continue`.

See [specs/001-issue-agent-sessions/quickstart.md](specs/001-issue-agent-sessions/quickstart.md) for
setup and validation. The behaviour is configured in [.agent/config.json](.agent/config.json) and
[.agent/instructions.md](.agent/instructions.md).
