# Contract: Issue-Thread Commands

**Feature**: `001-issue-driven-agent-workflow` | **Requirements**: FR-003, FR-015, FR-022, FR-024, FR-025, FR-026, FR-031

The command word is the only decision channel. There is no natural-language interpretation of
decisions: an unrecognised or unanchored phrase is treated as ordinary conversation.

Five words are **decisions** and change state or record a human decision: `halt`, `retry`,
`continue`, `approve`, `reject` (FR-026). Two words are **informational** and never change state or
create a decision record: `status`, `help`. `retry` and `continue` are also the only two entry points,
besides the request label, that start a run (FR-026, FR-031). Two further decisions have no command word
at all: `merge` and `close`, which the orchestrator observes from the pull request and records in the
thread (FR-033).

## Grammar

```text
command   := "/agent" SP word [SP reason]
word      := "halt" | "retry" | "continue" | "approve" | "reject" | "status" | "help"
reason    := free text, single line or block, stored verbatim after redaction
```

- The command must be the **first non-whitespace token of the comment**.
- Matching is case-insensitive for `word`; the stored reason is untouched.
- A comment containing `/agent` elsewhere (mid-sentence, quoted, inside a fenced code block) is **not**
  a command. This is what makes pasting a log containing the word harmless.
- Multiple commands in one comment: the first is honoured, the rest are ignored and listed in the
  reply.

## Effects

| Word | Precondition | Effect | Thread reply |
|------|--------------|--------|--------------|
| `halt` | Issue in `working` or `queued`; actor has write access | Queue a halt for the next action boundary. If `queued`, cancel before start. Post feedback: what was completed, what was left undone, and the state | `Halt acknowledged; stopping at the next boundary` then a feedback comment (FR-028) |
| `retry` | Issue in `failed`, `halted`, or `rejected`; actor has write access | Start a new run that continues the recorded state (FR-031, FR-032). Trigger origin `retry-command` | `Retry accepted by <actor>; run <n+1> started` |
| `continue` | Issue in `waiting` because a limit or an ambiguity was reported; actor has write access | Resume the run; when triggered by a consumption stop, raise this issue's allowance by the configured increment (FR-017). Trigger origin `continue-command` | `Continuing; allowance for this issue is now <amount>` |
| `approve` | A proposal exists; actor has write access | Record the approval intention in the thread and mark the proposal approved. **Does not merge and is not a precondition for merging** — the merge is the decision that applies the change (FR-007, FR-008) | `Approval recorded by <actor>; the merge in the pull request applies the change` |
| `reject` | A proposal exists; actor has write access | Record the rejection and its reason; cancel further work on the proposal (FR-006, US2 scenario 3) | `Rejection recorded by <actor>: <reason>` |
| `status` | Any state | Post (or refresh) the current state summary. Informational: no decision record, no state change | State summary with run id, consumption, and links |
| `help` | Any state | Post the command reference. Informational | Static help text |

## Rules

1. **Permission** — a command from a person without write access is ignored; the thread states that
   write access is required (FR-024). Permission is re-read at the moment of the decision, so a
   person demoted between trigger and decision loses authority (FR-025).
2. **Idempotency** — each comment id is processed at most once. A duplicated delivery produces no
   second run and no second decision record.
3. **No interpretation** — the orchestrator never infers a decision from prose such as "looks good to
   me". If a person wants an effect, they type the word. This is deliberate: it makes every
   consequential transition machine-checkable and auditable.
4. **Unknown word** — reply with the help text, change nothing.
5. **Language** — replies are English (constitution, FR-019), even when the surrounding thread is not.
   The reply never restates the issue text in another language.
6. **Global halt** — `/agent halt` in the issue named by `config.yml#globalHaltIssue` applies to all
   work; the reply states the scope that was affected (FR-015).
7. **Approval records, it does not apply** — no command causes a merge, a push to the default branch, or
   a release (FR-008). `/agent approve` is bookkeeping: it never blocks a merge and never causes one. A
   merge and a closed-without-merge decision come from the pull request, not from a command word, and are
   recorded by the orchestrator (`contracts/proposal.md` §"Decisions and their sources").
8. **Ignored directives** — the agent must end its answer with the `agent-ignored:` block defined in
   `contracts/thread-messages.md` §9; the orchestrator renders it as an `agent:notice` message and records
   a missing report as missing (FR-030).
9. **No command from prose, no decision from a review body** — a review counts only through its state
   (`approved`, `changes_requested`), never through the text a reviewer writes.
