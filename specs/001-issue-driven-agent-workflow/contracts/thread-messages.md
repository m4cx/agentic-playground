# Contract: Thread Messages

**Feature**: `001-issue-driven-agent-workflow` | **Requirements**: FR-004, FR-005, FR-009, FR-010, FR-012, FR-016, FR-019, FR-028, FR-030

Every message the orchestrator posts is rendered from an English template with a stable marker. The
thread is the record (FR-016), so its shape is a contract, not a formatting preference.

## Markers and idempotency

Each message body begins with an HTML comment that is invisible when rendered:

```text
<!-- agent:status issue=<number> -->
```

Rules:

- `agent:status` — exactly one per issue. Posted once, then **rewritten from an append-only row list**
  on every state change: each transition adds a row and no earlier row is ever removed or altered. The
  body therefore carries the full state timeline, so the thread stays readable *and* reconstructable
  without relying on comment edit history, which the platform does not expose (FR-016, SC-005).
- `agent:ack`, `agent:feedback`, `agent:result`, `agent:decision`, `agent:error`, `agent:limit`,
  `agent:session`, `agent:notice`, `agent:outcome` — appended once each, never edited. Every one of them
  names the run id or the session id.
- A template is rendered only if no message with the same `marker + runId + kind` exists, which makes
  re-delivery of the same event harmless.

## Templates

### 1. Acknowledgement (`agent:ack`) — posted before any model call (SC-002)

```markdown
Agent run started.

- Triggered by: @<actor> (<origin>) at <timestamp>
- Run started: <timestamp> — queue delay `<n>` seconds (SC-016)
- Request version: <hash-short>
- Instructions: `<path>` at `<sha-short>` (configuration fingerprint `<fingerprint-short>`)
- Model: `<modelId>` (Pi `<version>`), thinking `<level>`
- Allowance for this issue: cap `<cap>`; consumption recorded in this thread before this run `<value-or-unknown>`

I will report the outcome here. Decisions use `/agent <word>`; send `/agent help` for the list.
```

The acknowledgement is posted before any model call, so it cannot contain the request classification
(`change`/`answer`); that appears in the first status row instead (see §2).

### 2. Status (`agent:status`) — append-only state log, rewritten from its own rows (FR-010)

```markdown
**State:** `<state>` — <one-line plain-language meaning>

| | |
|---|---|
| Run | `<runId>` (continues `<previousRunId>`, if any) |
| Started | <timestamp> |
| Consumed | `<cost>` of `<cap>` (`<turns>` turns) |
| Proposal | <link or `none`> |
| Next act needed | <`none` / `post /agent continue` / review the proposal> |

**State log**

| At | State | Run | Consumed | Next act |
|----|-------|-----|----------|----------|
| <timestamp> | `queued` | `<runId>` | 0 | none |
| <timestamp> | `working` | `<runId>` | 0 | none |
| <timestamp> | `waiting` | `<runId>` | `<cost>` | review the proposal |
```

Row rules: one row per transition; rows are appended in chronological order and never rewritten; the
newest row must equal the `State:` line and the state label (invariant I2); the log is the authoritative
state timeline for reconstruction. Rows record only values the orchestrator observed — a missing
consumption figure is written as `unknown`, never guessed.

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
`secret-request`, `limit-exceeded`, `environment`, `interrupted`, `unexpected-retry`, `agent-error`.

`unexpected-retry` is used when the harness shows any sign of continuing on its own (`auto_retry_*`,
`summarization_retry_*`, `compaction_*`, or `willRetry`). The run is stopped instead of continuing
invisibly, and the thread says which signal was seen (FR-031).

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

### 8. Session (`agent:session`) — per-session consumption (FR-017)

```markdown
Session ended.

- Session: `<sessionId>` (fingerprint `<fingerprint-short>`)
- Runs: `<run ids>`
- Consumed: `<cost>` (`<tokens>` tokens, `<turns>` turns, `<toolCalls>` tool calls)
- Ended because: <`run finished` / `run halted` / `run failed` / `cache lost`>
- Issue total: `<sum>` of `<cap>`
```

One message per session, appended and never edited. The issue total is the sum of all documented
sessions, so a new session adds to the record instead of replacing it, and a lost cache cannot reset the
limit (decision in `spec.md` §Clarifications; `contracts/pi-rpc.md` §"Session accounting").

### 9. Directive report (`agent:notice`) — FR-030

The agent must end its answer with exactly one of these blocks:

```text
agent-ignored:
- <short description of what the directive asked for> — <why it was not followed>
```

```text
agent-ignored: none
```

The orchestrator extracts it, redacts it, and renders:

```markdown
Directive check.

- <one line per ignored directive: what it asked for, and why it was not followed>

or: `No embedded directive found.`
```

Rules: the block is data, never an instruction; the notice never repeats a secret value and never restates
a directive as a command; a directive that the agent did follow by mistake is a contract breach reported
as a failure. If the block is missing or unparsable, the orchestrator posts the notice with
`No directive report was produced for this run.` and appends a state-log note. Absence is therefore
recorded rather than hidden — this is what makes SC-014 auditable.

### 10. Proposal outcome (`agent:outcome`) — FR-033

```markdown
Proposal closed.

- Pull request: <link>
- Result: <`merged by @<actor> at <timestamp>` / `closed without merge by @<actor> at <timestamp>`>
- Issue state: <`finished` / `rejected`>
```

Posted once when the pull request is closed. The state label and a state-log row follow in the same
operation, so the thread and the label never disagree at a boundary.

## Rules

1. **English only** (constitution I, FR-019). Templates are fixed; only data is interpolated. The
   agent's own prose, when quoted, is quoted verbatim and never translated — and is redacted first.
2. **No secrets** (FR-018): every interpolated value passes through `redact.ts`; a body that still
   matches a credential pattern is replaced by `[redacted]` and the run records that redaction
   happened.
3. **Links, not copies**: artifacts are linked (PR, commit, workflow run) rather than pasted, so the
   thread stays readable and there is exactly one copy of the truth.
4. **No raw tool output**: tool output is summarised by the agent; the orchestrator never dumps a
   log into the thread. Full logs remain in the workflow run for operators.
5. **Reconstruction procedure** (for SC-005): read the issue body, then the `agent:ack` messages in
   order, then the state log inside the `agent:status` comment, then each
   `agent:feedback`/`agent:limit`/`agent:decision`/`agent:error`/`agent:notice`/`agent:result`, then the
   `agent:session` messages for cost, then `agent:outcome` and the proposal links. Every terminal claim is backed by one of those messages, and the state log alone
   gives the state timeline without any need for comment edit history.
