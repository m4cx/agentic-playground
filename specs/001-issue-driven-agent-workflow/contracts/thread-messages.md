# Contract: Thread Messages

**Feature**: `001-issue-driven-agent-workflow` | **Requirements**: FR-004, FR-005, FR-009, FR-010, FR-012, FR-016, FR-019, FR-028, FR-030

Every message the orchestrator posts is rendered from an English template with a stable marker. The
thread is the record (FR-016), so its shape is a contract, not a formatting preference.

## Markers and idempotency

Each message body begins with an HTML comment that is invisible when rendered:

```text
<!-- agent:status run=<runId> state=<state> -->
```

Rules:

- `agent:status` — exactly one per issue. Posted once, then **edited** on every state change. This
  keeps the thread readable (one live status line) while the comment's edit history is the record.
- `agent:ack`, `agent:feedback`, `agent:result`, `agent:decision`, `agent:error`, `agent:limit` —
  appended once each, never edited.
- A template is rendered only if no message with the same `marker + runId + kind` exists, which makes
  re-delivery of the same event harmless.

## Templates

### 1. Acknowledgement (`agent:ack`) — posted before any model call (SC-002)

```markdown
Agent run started.

- Triggered by: @<actor> (<origin>)
- Request version: <hash-short>
- Instructions: `<path>` at `<sha-short>`
- Model: `<modelId>` (Pi `<version>`)
- Allowance for this issue: `<remaining>` of `<cap>`

I will report the outcome here. Decisions use `/agent <word>`; send `/agent help` for the list.
```

### 2. Status (`agent:status`) — edited in place (FR-010)

```markdown
**State:** `<state>` — <one-line plain-language meaning>

| | |
|---|---|
| Run | `<runId>` (continues `<previousRunId>`, if any) |
| Started | <timestamp> |
| Consumed | `<cost>` of `<cap>` (`<turns>` turns) |
| Proposal | <link or `none`> |
| Next act needed | <`none` / `post /agent continue` / review the proposal> |
```

The `Next act needed` cell is what removes the "what is the status?" follow-up question (SC-007).

### 3. Feedback (`agent:feedback`) — before any halt or pause (FR-028)

```markdown
Stopping at an action boundary.

**Completed**
- <bullet per finished step>

**Not done**
- <bullet per unfinished step, or `nothing outstanding`>

**State to resume from**
- <files touched, branch name if any, pending question>

Consumed so far: `<cost>`. Resume with `/agent retry` (halt) or `/agent continue` (waiting).
```

### 4. Result (`agent:result`) — the outcome (FR-005)

```markdown
Run finished.

**Outcome:** <`no changes needed` / `proposal opened` / `answer only`>

**What I did**
- <bullet per action>

**Artifacts**
- Proposal: <link>
- Files changed: `<n>` in `<paths, truncated list>`

**What a human must do next**
- <review and merge / nothing / answer the question above>

Consumed: `<cost>` (`<turns>` turns, `<toolCalls>` tool calls).
```

### 5. Failure (`agent:error`) — (FR-012)

```markdown
Run failed.

**Reason:** `<enum>` — <plain-language explanation>
**Can you fix it?** <`yes: <one sentence>` / `no: this is on the operator side`>

<For `interrupted`: "The job ended without reporting; nothing was lost that is recorded here.">

Consumed: `<cost>`. Retry with `/agent retry` if the reason is on your side.
```

Failure enum: `request-unclear`, `request-too-large`, `needs-permission`, `content-conflict`,
`secret-request`, `limit-exceeded`, `environment`, `interrupted`, `agent-error`.

### 6. Decision record (`agent:decision`) — (FR-009)

```markdown
Decision recorded: `<kind>`
- By: @<actor> at <timestamp>
- Reason: <verbatim reason, sanitised, or `none given`>
- Applied: <`immediately` / `at boundary <n>`>
```

### 7. Limit notice (`agent:limit`) — (FR-017)

```markdown
Consumption limit reached.

Consumed `<cost>` of an allowance of `<cap>` (`<turns>` turns). I stopped at the last boundary.

To continue, a person with write access posts `/agent continue`. That raises this issue's allowance
by `<increment>`. Nothing further happens until then.
```

## Rules

1. **English only** (constitution I, FR-019). Templates are fixed; only data is interpolated. The
   agent's own prose, when quoted, is quoted verbatim and never translated — and is redacted first.
2. **No secrets** (FR-018): every interpolated value passes through `redact.js`; a body that still
   matches a credential pattern is replaced by `[redacted]` and the run records that redaction
   happened.
3. **Links, not copies**: artifacts are linked (PR, commit, workflow run) rather than pasted, so the
   thread stays readable and there is exactly one copy of the truth.
4. **No raw tool output**: tool output is summarised by the agent; the orchestrator never dumps a
   log into the thread. Full logs remain in the workflow run for operators.
5. **Reconstruction procedure** (for SC-005): read the issue body, then the `agent:ack` messages in
   order, then each `agent:feedback`/`agent:limit`/`agent:decision`/`agent:error`/`agent:result`, then
   follow the proposal links. Every terminal claim is backed by one of those messages, and the
   status comment's edit history gives the state timeline.
