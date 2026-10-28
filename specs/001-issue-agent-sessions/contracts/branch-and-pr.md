# Contract: Branch and Pull Request

**Feature**: `001-issue-agent-sessions` | **Version**: 1

This contract defines branch naming, branch lifecycle, commits, pushes, and the review artifact.
It is implemented by `src/agent/slug.ts`, `src/agent/workspace.ts`, and `src/agent/pr.ts`.

## Branch name

```text
feature/<issue-number>-<slug>
```

- `issue-number`: the repository-unique GitHub issue number, decimal, no padding (`42`).
- `slug`: derived once, when the session is first created:

  1. Take the issue title.
  2. Transliterate to ASCII where a standard mapping exists (`ä` → `ae`, `é` → `e`); case-fold to
     lowercase.
  3. Replace every run of characters outside `[a-z0-9]` with a single `-`.
  4. Trim leading and trailing `-`.
  5. Truncate to at most 50 characters at the last `-` boundary; if that leaves nothing, truncate to
     50 characters.
  6. If the result is empty, use `issue`.
  7. Validate `^[a-z0-9]+(?:-[a-z0-9]+)*$` and length 1..50; a failure is an `environment` failure.

Examples:

| Issue | Branch |
|-------|--------|
| #42 "Fix login timeout" | `feature/42-fix-login-timeout` |
| #7 "Überarbeite die Anmeldung" | `feature/7-ueberarbeite-die-anmeldung` |
| #99 "🔥🔥🔥" | `feature/99-issue` |
| #123 "A very long title that keeps going beyond the configured slug limit and then some" | `feature/123-a-very-long-title-that-keeps-going-beyond-the` |

The slug is stored in the session marker on first creation. A later title edit never renames the
branch; the agent is told the current title and the fixed branch name.

## Branch lifecycle

1. **First run with changes**: fetch the default branch, create the branch at the current default
   HEAD, apply the agent's changes, commit, push.
2. **First run without file changes**: create the branch at the current default HEAD with one empty
   commit that records the session outcome, push it, and open the pull request with the result summary.
   The diff is empty; the review artifact still exists and can be closed by a human.
3. **Resume**:
   - Fetch `origin/<default>` and `origin/<branch>`.
   - If the branch exists, check it out and merge `origin/<default>` with `--no-edit`.
   - If the merge conflicts, leave the conflict markers in the workspace, record the conflicted paths,
     and include them in the prompt. The agent resolves what it can.
   - If the branch does not exist, recreate it from the current default and state the recovery in the
     thread.
4. **Push**: `git push origin HEAD:refs/heads/<branch>` with no force, no lease, no tags.
5. **Never**: commit to the default branch, merge the branch into another branch, rebase, reset,
   force-push, delete the branch, or rewrite published history.

A branch is required for every run that ends `finished` or `waiting`. A `failed` or `stopped` run may
have no branch if no work was produced; if file changes exist, the orchestrator commits them as a
work-in-progress commit and pushes the branch without opening a pull request.

## Commit contract

- Author: `agentic-playground <agent@users.noreply.github.com>` (a fixed bot identity, not a person).
- Message subject: `agent: work on issue #<n>`.
- Message body:

  ```text
  Session: issue-<n>
  Run: <run-id>
  State: <state>

  <validated English summary, first 500 characters>
  ```

- One commit per run. The orchestrator does not amend or squash prior runs.
- Only files changed in the workspace are committed. If `git status --porcelain` is empty and the run
  ends `finished` or `waiting`, create one empty commit with the same message and a body stating that
  no file changes were produced. If the run fails or stops with file changes, commit them with the
  subject `agent: work in progress on issue #<n>` and a body naming the failure or stop reason.
- The commit is created by the orchestrator after Pi exits; Pi never runs `git commit` or `git push`.

## Pull request contract

- **Head**: the session branch. **Base**: the repository default branch.
- **Idempotency**: before creating, search open PRs with `head=<owner>:<branch>`; if one exists, reuse
  it and do not change its body.
- **Title**: `Agent work for issue #<n>` unless the agent's `prTitle` is valid English and within 120
  characters, in which case use it.
- **Body**:

  ```markdown
  ## Agent result for issue #<n>

  <validated English summary>

  ### Verification

  - <item>

  ### Open questions

  - None.

  ### Not completed

  - None.

  Closes #<n>
  ```

- **Draft**: false. The change is ready for review; the agent has already run its verification.
- **Labels**: none required. The orchestrator may add `agent:review` if it exists; it never creates
  labels.
- **Merge**: never performed by the orchestrator or the agent. Only a human with merge permission can
  merge.

## Merge and close outcomes

The `agent-review.yml` workflow observes:

| Event | Action |
|-------|--------|
| `pull_request.closed` with `merged == true` | Comment on the linked issue with the merger and timestamp; set state `finished`; keep the branch |
| `pull_request.closed` with `merged == false` | Comment on the linked issue with the closer and timestamp; set state `stopped` |
| `issues.closed` | If no merge already set `finished`, set `stopped`; comment with the actor and timestamp |

The linked issue is derived from the PR head branch: `^feature/(\d+)-`. If the branch does not match,
the workflow reads `Closes #<n>` from the PR body; if neither yields an issue, it posts nothing.

Outcome comments are idempotent: the state marker records the PR number and the observed outcome, so a
replayed `closed` event does not post twice.

## No-change and conflict behavior

| Situation | Branch | PR | State |
|-----------|--------|----|-------|
| Agent changed files | created/updated | created/updated | `finished` or `waiting` |
| Agent changed nothing | created with one empty commit | created with the result summary | `finished` or `waiting` |
| Run fails or stops with changes | created/updated with a WIP commit | not created | `failed` or `stopped` |
| Run fails or stops without changes | absent | absent | `failed` or `stopped` |
| Default-branch merge conflicts the agent cannot resolve | unchanged | not created/updated | `failed`, conflicting paths listed |
| Push rejected (non-fast-forward) | unchanged | not created | `failed`, next action: re-run after a human resolves the branch |
| Missing push permission | unchanged | not created | `failed`, `environment` reason |

## Verification in the branch

Before pushing, the orchestrator confirms:

1. The branch name matches the contract.
2. The workspace is the expected repository and the branch is not the default branch.
3. The diff contains at least one file and no path outside the workspace.
4. No file larger than 10 MB and no submodule change is included; otherwise the run fails with
   `workspace` and the paths are reported.
5. The commit message and PR body pass the English-template renderer and redaction.
