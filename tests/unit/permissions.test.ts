import { test } from "node:test";
import assert from "node:assert/strict";
import { checkWriteAccess, isWritePermission } from "../../src/agent/permissions.js";
import type { GitHubClient } from "../../src/agent/github.js";

function client(permission: string | Error): GitHubClient {
  return {
    async getCollaboratorPermission() {
      if (permission instanceof Error) {
        throw permission;
      }
      return permission;
    },
  } as unknown as GitHubClient;
}

test("accepts write, maintain, and admin", async () => {
  for (const permission of ["write", "maintain", "admin"]) {
    assert.equal(isWritePermission(permission), true);
    assert.equal(await checkWriteAccess(client(permission), "owner", "repo", "user"), permission);
  }
});

test("rejects read, triage, none, and unknown", async () => {
  for (const permission of ["read", "triage", "none", "other"]) {
    assert.equal(isWritePermission(permission), false);
    assert.equal(await checkWriteAccess(client(permission), "owner", "repo", "user"), null);
  }
});

test("fails with permission-check when the API fails", async () => {
  await assert.rejects(
    () => checkWriteAccess(client(new Error("network")), "owner", "repo", "user"),
    (error: unknown) => (error as { code?: string }).code === "permission-check",
  );
});
