/**
 * Permission gate (FR-024, FR-025).
 *
 * Permission is read from repository collaborator permissions, never from a
 * comment or a claim in the issue. It is re-read at every decision point so that a
 * person demoted after triggering a run cannot halt, retry, continue, approve, or
 * reject it afterwards.
 */

export interface PermissionLookup {
  getCollaboratorPermission(login: string): Promise<{ permission: string }>;
}

export const WRITE_PERMISSIONS: ReadonlySet<string> = new Set(["admin", "maintain", "write", "push"]);

export type DenyReason = "no-login" | "insufficient-permission" | "lookup-failed";

export interface PermissionDecision {
  allowed: boolean;
  login: string;
  permission: string;
  reason?: DenyReason;
}

export function isWritePermission(permission: string): boolean {
  return WRITE_PERMISSIONS.has(permission.toLowerCase());
}

export class PermissionGate {
  private readonly client: PermissionLookup;

  constructor(client: PermissionLookup) {
    this.client = client;
  }

  /** Check whether a login may start or decide work right now. */
  async check(login: string | null | undefined): Promise<PermissionDecision> {
    const trimmed = (login ?? "").trim();
    if (trimmed.length === 0) {
      return { allowed: false, login: "", permission: "none", reason: "no-login" };
    }
    try {
      const { permission } = await this.client.getCollaboratorPermission(trimmed);
      const normalised = (permission ?? "none").toLowerCase();
      if (!isWritePermission(normalised)) {
        return { allowed: false, login: trimmed, permission: normalised, reason: "insufficient-permission" };
      }
      return { allowed: true, login: trimmed, permission: normalised };
    } catch {
      return { allowed: false, login: trimmed, permission: "unknown", reason: "lookup-failed" };
    }
  }

  /**
   * Re-check at the moment a decision is recorded. Same lookup, different intent:
   * the caller must refuse the decision when this returns `allowed: false`.
   */
  async recheckAtDecision(login: string | null | undefined): Promise<PermissionDecision> {
    return this.check(login);
  }
}

/** The sentence a denied person sees. Fixed English, no reflection of their text. */
export function permissionDenialMessage(decision: PermissionDecision): string {
  if (decision.reason === "lookup-failed") {
    return "This action was not applied: the repository permission of the account could not be verified.";
  }
  if (decision.reason === "no-login") {
    return "This action was not applied: the acting account could not be identified.";
  }
  return "This action was not applied: write access to this repository is required.";
}
