import type { PiRunRequest, PiRunResult, PiRunner } from "../src/agent/pi.js";
import { AgentError } from "../src/agent/errors.js";

export type PiScript = (request: PiRunRequest) => Promise<PiRunResult> | PiRunResult;

export class FakePi implements PiRunner {
  readonly calls: PiRunRequest[] = [];
  private readonly script: PiScript;

  constructor(script: PiScript) {
    this.script = script;
  }

  async run(request: PiRunRequest): Promise<PiRunResult> {
    this.calls.push(request);
    return this.script(request);
  }
}

export function outputText(output: Record<string, unknown>): string {
  return [
    "The work is complete.",
    "",
    "```json",
    JSON.stringify(output, null, 2),
    "```",
  ].join("\n");
}

export function defaultOutput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    summary: "Implemented the requested change and verified it.",
    verification: ["npm test — passed"],
    openQuestions: [],
    couldNotComplete: [],
    prTitle: "Implement the requested change",
    prBody: "This pull request implements the requested change and links issue #42.",
    state: "finished",
    ...overrides,
  };
}

export function failWith(code: "timeout" | "environment"): never {
  throw new AgentError(code, `simulated ${code}`);
}
