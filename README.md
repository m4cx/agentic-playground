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

## ToDo app

Issue #1 added a small, file-backed todo app under `src/todo`. It supports:

- creating a todo with a title, optional description, and optional ISO 8601 due date;
- completing a todo;
- adding a checklist to a todo and toggling checklist items;
- updating or removing the due date;
- archiving completed todos.

The domain logic is pure and fully covered by unit tests. Persistence is provided by a JSON file
store, and an in-memory store is available for testing. A minimal CLI is available after building:

```bash
npm run build
npm run todo -- add "Buy milk" --due 2026-12-31
npm run todo -- list
npm run todo -- complete <id>
npm run todo -- checklist-add <id> "Passport"
npm run todo -- due <id> 2026-12-31
npm run todo -- archive <id>
```

Use `npm run todo -- --help` for the full command list.
