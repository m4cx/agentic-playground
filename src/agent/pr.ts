import type { AgentOutput } from "./output.js";
import type { GitHubClient, PullRequest } from "./github.js";
import type { AgentSession } from "./state.js";

export function renderPullRequestBody(session: AgentSession, output: AgentOutput): string {
  const verification =
    output.verification.length > 0
      ? output.verification.map((item) => `- ${item}`).join("\n")
      : "- No verification was reported.";
  const questions =
    output.openQuestions.length > 0
      ? output.openQuestions.map((item) => `- ${item}`).join("\n")
      : "- None.";
  const incomplete =
    output.couldNotComplete.length > 0
      ? output.couldNotComplete.map((item) => `- ${item}`).join("\n")
      : "- None.";
  return [
    `## Agent result for issue #${session.issueNumber}`,
    "",
    output.summary,
    "",
    "### Verification",
    "",
    verification,
    "",
    "### Open questions",
    "",
    questions,
    "",
    "### Not completed",
    "",
    incomplete,
    "",
    `Closes #${session.issueNumber}`,
  ].join("\n");
}

export async function ensurePullRequest(input: {
  client: GitHubClient;
  owner: string;
  repo: string;
  session: AgentSession;
  output: AgentOutput;
  defaultBranch: string;
}): Promise<PullRequest> {
  const existing = await input.client.listPullRequests(
    input.owner,
    input.repo,
    `${input.owner}:${input.session.branchName}`,
  );
  const open = existing.find((pull) => pull.head.ref === input.session.branchName);
  if (open) {
    return open;
  }
  return input.client.createPullRequest(input.owner, input.repo, {
    title: input.output.prTitle,
    head: input.session.branchName,
    base: input.defaultBranch,
    body: renderPullRequestBody(input.session, input.output),
  });
}

export function branchUrl(owner: string, repo: string, branch: string): string {
  const encoded = branch.split("/").map((part) => encodeURIComponent(part)).join("/");
  return `https://github.com/${owner}/${repo}/tree/${encoded}`;
}
