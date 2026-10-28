import { AgentError, errorMessage } from "./errors.js";
import type { GitHubClient } from "./github.js";
import type { PermissionLevel } from "./state.js";

const WRITE_PERMISSIONS: readonly string[] = ["admin", "maintain", "write"];

export function isWritePermission(value: string): value is PermissionLevel {
  return WRITE_PERMISSIONS.includes(value);
}

export async function checkWriteAccess(
  client: GitHubClient,
  owner: string,
  repo: string,
  username: string,
): Promise<PermissionLevel | null> {
  let permission: string;
  try {
    permission = await client.getCollaboratorPermission(owner, repo, username);
  } catch (error) {
    throw new AgentError(
      "permission-check",
      `could not check write access for ${username}: ${errorMessage(error)}`,
    );
  }
  return isWritePermission(permission) ? permission : null;
}
