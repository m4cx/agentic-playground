export type FailureCode =
  | "permission-check"
  | "environment"
  | "state-recovery"
  | "state-transition"
  | "agent-output"
  | "unexpected-retry"
  | "timeout"
  | "push"
  | "workspace"
  | "redaction"
  | "github"
  | "trigger";

export class AgentError extends Error {
  readonly code: FailureCode;

  constructor(code: FailureCode, message: string) {
    super(message);
    this.name = "AgentError";
    this.code = code;
  }
}

export function isAgentError(error: unknown): error is AgentError {
  return error instanceof AgentError;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
