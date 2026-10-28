# Quickstart: Issue-Driven Agent Sessions

**Feature**: `001-issue-agent-sessions` | **Version**: 1

This guide proves the feature end to end against a sandbox repository. It describes what to configure,
what to run, and what to observe. It deliberately contains no implementation bodies; the contracts and
`tasks.md` carry those.

## Prerequisites

- A GitHub repository where you can change settings, labels, secrets, and branch protection.
- GitHub Actions enabled.
- Node.js 22.19 or newer locally for the build and unit tests (the workflows use their own Node).
- The GitHub CLI `gh` for the manual scenarios (optional but convenient).
- A model provider key for the endpoint in `.agent/models.json`; the initial configuration uses
  `OLLAMA_API_KEY` for the Ollama Cloud compatible endpoint.

## One-time setup

### 1. Build and test locally

```bash
npm ci
npm run typecheck
npm test
```

Expected: typecheck passes, all unit, integration, and contract tests pass, `dist/` is produced and
remains untracked.

### 2. Create the trigger label

```bash
gh label create "agent:run" \
  --description "Hand this issue to the coding agent" \
  --color "1D76DB"
```

The label name must match `.agent/config.json` and the `agent-run.yml` filter. The contract test fails
CI if they diverge.

### 3. Add the provider secret

```bash
gh secret set OLLAMA_API_KEY
```

The key is available to the orchestrator and passed only to the Pi child. It is never written to a
comment, commit, or PR.

Optional: `gh secret set PR_TOKEN` if `GITHUB_TOKEN` is not allowed to create pull requests.

### 4. Grant workflow permissions

Repository **Settings → Actions → General → Workflow permissions**:

- Select **Read and write permissions**.
- Allow GitHub Actions to create and approve pull requests (needed to open the review PR). Without this
  setting, the branch is pushed but PR creation fails with HTTP 403.
- Do not allow fork pull requests to run workflows with write tokens.

If the repository policy cannot enable that setting, create a fine-grained `PR_TOKEN` secret with
**Contents: Read** and **Pull requests: Write** for this repository. The orchestrator uses it only for
pull-request creation; the GitHub App token still performs every other operation.

The workflow itself requests only:

```yaml
permissions:
  contents: write
  issues: write
  pull-requests: write
```

### 5. Protect the default branch

Require a pull request before merging, require at least one approval, and disallow force pushes and
deletions. The agent never merges; this setting is the second barrier if a bug ever tries.

### 6. Confirm the egress allowlist

`.agent/config.json` must list:

```json
"network": {
  "allowHosts": ["ollama.com", "registry.npmjs.org"]
}
```

The host of the provider `baseUrl` in `.agent/models.json` must be present. The config loader fails
closed otherwise.

## Validation scenarios

### S1 — Happy path: issue to branch and pull request

1. Create an issue with a small, self-contained task:

   ```bash
   gh issue create \
     --title "Add a health-check script" \
     --body "Create scripts/health-check.sh that prints ok and exits 0. Add a short README note."
   ```

2. Apply the label:

   ```bash
   gh issue edit <number> --add-label "agent:run"
   ```

3. Observe the issue thread.

**Expected**:

- Within 2 minutes of the job starting, an acknowledgement comment names session `issue-<n>` and
  branch `feature/<n>-<slug>`.
- The label is removed after acceptance.
- A branch named `feature/<n>-<slug>` exists.
- A pull request targets the default branch and is linked from the result comment.
- The result comment states what changed, the verification performed, open questions, not-completed
  items, and the next action.
- The default branch is unchanged until a human merges.
- The commit author is the fixed bot identity; the commit message is English.
- The state comment shows `finished`.

**Verify**:

```bash
gh issue view <number> --comments
gh pr list --head "feature/<n>-<slug>"
git fetch origin
git log --oneline origin/feature/<n>-<slug>
```

### S2 — Resume: same session, same branch, fresh default branch

1. After S1, add a follow-up instruction:

   ```bash
   gh issue comment <number> --body "/agent continue Also cover the failure path in the script."
   ```

2. Push a small commit to the default branch from another change (or wait for one) so the feature
   branch is behind.

3. Observe the issue and the branch.

**Expected**:

- No second branch and no second pull request.
- The same session `issue-<n>` is resumed.
- The current default branch is merged into the feature branch before the new work.
- The result comment states which earlier work was reused and what changed.
- The state comment still shows the same session and branch.

**Verify**:

```bash
gh pr list --head "feature/<n>-<slug>" --state all
git log --oneline --graph origin/feature/<n>-<slug>
```

### S3 — Ordinary comment does not start work

1. Comment without the resume command:

   ```bash
   gh issue comment <number> --body "Thanks, looks good!"
   ```

2. Wait two minutes.

**Expected**: no new run, no new comment from the agent, no state change. The thread may remain
silent; this is correct.

### S4 — Unauthorized actor is ignored

1. From an account with only read access, apply the label or post the resume command.
2. Observe the issue.

**Expected**: no work starts. One English comment states that write access is required. The state
marker is unchanged.

### S5 — Failure is visible and does not retry

1. Temporarily break the model configuration (for example, point the provider at an unreachable host
   in a sandbox branch) or remove the provider secret in the sandbox repository.
2. Trigger a session.
3. Observe the issue.

**Expected**:

- The state comment shows `failed`.
- The failure comment states a reason code and a plain-language next action.
- No automatic retry appears in the thread and no second attempt starts.
- A later `/agent continue` (or re-applied label) resumes the same session after the cause is fixed.
- The branch, if one already existed, still contains the prior commits.

### S6 — Human merge closes the session

1. Review the pull request from S1.
2. Merge it as a human.
3. Observe the issue.

**Expected**:

- The issue receives an outcome comment naming the merger and the merge time.
- The state comment shows `finished`.
- The branch remains; it is not deleted by the workflow.
- No agent run starts as a result of the merge.

### S7 — Egress policy is enforced

On the runner, after the egress step and before Pi starts (or in a dedicated verification job):

```bash
sudo -u agent-egress curl -sS --max-time 5 https://example.com
# expected: blocked / connection failure

dmesg | grep agent-egress-blocked
# expected: one or more entries naming the denied destination

sudo -u agent-egress curl -sS --max-time 5 https://ollama.com
# expected: reachable (an HTTP response, not a connection failure)

sudo -u agent-egress curl -sS --max-time 5 https://registry.npmjs.org
# expected: reachable
```

The job log prints the resolved allowlist and the applied rules. A failure to apply the policy fails
the job before the agent starts.

### S8 — Language conformance

1. Create an issue whose body is in a non-English language but asks for a small code change.
2. Trigger and complete the session.

**Expected**:

- The issue body remains in its original language.
- The acknowledgement, result comment, commit message, PR title/body, branch name, and committed code
  comments are English.
- The agent does not translate the issue body into the thread.

**Verify**:

```bash
gh issue view <number> --comments
git log -1 --format=%B origin/feature/<n>-<slug>
gh pr view <pr-number>
```

## Manual end-to-end checklist

| Check | Expected |
|-------|----------|
| Trigger label accepted once | label removed, one acknowledgement |
| Permission gate | read-only actor produces no work |
| Branch name | `feature/<n>-<slug>` exactly |
| Commits | English message, bot author, no default-branch commit |
| Pull request | one open PR per issue branch, links the issue |
| Merge | only a human merges; thread records actor and time |
| Resume | same session, same branch, default merged first |
| Failure | state `failed`, reason and next action, no auto retry |
| Secrets | no token or key in comments, commits, PR, or logs |
| Egress | undeclared host blocked; allowlisted host reachable |
| Language | durable artifacts English |

## Troubleshooting

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| No run after label | Label name differs from config or workflow filter | Run the contract test; check the label spelling |
| No run after comment | Command not on the first line, comment on a PR, or bot author | Check `contracts/triggers.md` |
| `permission-check` failure | Token cannot read collaborator permission | Check workflow permissions and the token's scope |
| `environment` failure before the model call | Pi version mismatch, missing secret, allowlist host not resolvable | Read the job log; the failure is fail-closed |
| `agent-output` failure | Missing or invalid JSON block | Inspect the run log (redacted); adjust the issue or instructions |
| Branch push rejected | Branch moved or protection rule denied | The thread says `push`; resolve manually, then resume |
| Default merge conflicts | Agent could not resolve them | The failure lists the paths; resolve and resume |
| Cache miss on resume | Cache evicted or config fingerprint changed | Expected; the thread digest is used instead |
| PR not created | The run failed or is still active, or the workflow lacks PR permission | Check the result comment and repository settings |

## Related artifacts

- [spec.md](./spec.md) — requirements and success criteria
- [plan.md](./plan.md) — architecture and constitution check
- [data-model.md](./data-model.md) — entities and state transitions
- [contracts/triggers.md](./contracts/triggers.md) — event and permission behavior
- [contracts/session-state.md](./contracts/session-state.md) — state marker and transitions
- [contracts/branch-and-pr.md](./contracts/branch-and-pr.md) — branch, commit, and PR rules
- [contracts/agent-io.md](./contracts/agent-io.md) — prompt and structured output
- [contracts/config.md](./contracts/config.md) — configuration schema
- [contracts/pi-rpc.md](./contracts/pi-rpc.md) — Pi RPC, cache, deadlines, egress
