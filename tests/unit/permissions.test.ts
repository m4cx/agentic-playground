import assert from "node:assert/strict";
import test from "node:test";

import {
  isWritePermission,
  PermissionGate,
  permissionDenialMessage,
  WRITE_PERMISSIONS,
  type PermissionLookup,
} from "../../src/agent/permissions.js";

function lookup(table: Record<string, string>): PermissionLookup & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async getCollaboratorPermission(login: string) {
      calls.push(login);
      const permission = table[login];
      if (permission === undefined) throw new Error("unknown login");
      return { permission };
    },
  };
}

test("write and above are allowed", async () => {
  for (const permission of ["write", "maintain", "admin", "push"]) {
    assert.equal(isWritePermission(permission), true);
    assert.ok(WRITE_PERMISSIONS.has(permission));
    const gate = new PermissionGate(lookup({ person: permission }));
    const decision = await gate.check("person");
    assert.equal(decision.allowed, true, permission);
  }
});

test("read, triage, and none are denied", async () => {
  for (const permission of ["read", "triage", "none"]) {
    const gate = new PermissionGate(lookup({ person: permission }));
    const decision = await gate.check("person");
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "insufficient-permission");
    assert.match(permissionDenialMessage(decision), /write access/);
  }
});

test("a login that cannot be resolved is denied, never assumed permitted", async () => {
  const gate = new PermissionGate(lookup({}));
  const decision = await gate.check("stranger");
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "lookup-failed");
  assert.match(permissionDenialMessage(decision), /could not be verified/);
});

test("an empty login is denied without a lookup", async () => {
  const client = lookup({});
  const gate = new PermissionGate(client);
  const decision = await gate.check("");
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "no-login");
  assert.equal(client.calls.length, 0);
});

test("a demotion between trigger and decision is refused", async () => {
  let permission = "write";
  const gate = new PermissionGate({
    async getCollaboratorPermission() {
      return { permission };
    },
  });
  assert.equal((await gate.check("person")).allowed, true);
  permission = "read";
  const decision = await gate.recheckAtDecision("person");
  assert.equal(decision.allowed, false);
  assert.equal(decision.permission, "read");
});
