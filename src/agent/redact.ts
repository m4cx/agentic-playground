/**
 * Credential redaction (FR-018, SC-010).
 *
 * Every value that leaves the orchestrator — a thread body, a committed file, a
 * commit message — passes through `redact`. A caller records whether a redaction
 * happened, because a redaction is a signal, not a silent rewrite.
 */

export interface RedactionResult {
  text: string;
  redacted: boolean;
  /** Names of the matched patterns; safe to log, contains no matched value. */
  reasons: string[];
}

interface CredentialPattern {
  name: string;
  pattern: RegExp;
  /** Replace the whole match (default) or only a captured value group. */
  valueGroup?: number;
  /** Keep the match prefix and replace only the value; used for KEY=value lines. */
  replacement?: string;
}

const PATTERNS: CredentialPattern[] = [
  { name: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: "github-fine-grained-token", pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { name: "anthropic-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: "openai-key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/g },
  { name: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  {
    name: "private-key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  { name: "bearer-token", pattern: /\b(?:Bearer|Token)\s+[A-Za-z0-9._~+/-]{20,}=*/gi },
  { name: "azure-key", pattern: /\b(?:AccountKey|SharedAccessKey)=[A-Za-z0-9+/=]{20,}/g },
  {
    name: "dotenv-assignment",
    pattern:
      /^([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|CREDENTIALS)[A-Z0-9_]*)\s*=\s*(.+)$/gm,
    valueGroup: 2,
    replacement: "[redacted]",
  },
];

const MIN_SECRET_LENGTH = 6;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace credentials and known secret values with `[redacted]`.
 *
 * `secrets` carries the actual job secret values (provider key, token) so that a
 * value which does not match a known shape is still removed when it is known.
 */
export function redact(text: string, secrets: readonly string[] = []): RedactionResult {
  let output = text;
  const reasons = new Set<string>();

  for (const entry of PATTERNS) {
    entry.pattern.lastIndex = 0;
    if (entry.valueGroup !== undefined) {
      const group = entry.valueGroup;
      output = output.replace(entry.pattern, (match: string, ...args: unknown[]) => {
        const captured = args[group - 1];
        if (typeof captured !== "string") return match;
        reasons.add(entry.name);
        return match.replace(captured, entry.replacement ?? "[redacted]");
      });
      continue;
    }
    output = output.replace(entry.pattern, () => {
      reasons.add(entry.name);
      return "[redacted]";
    });
  }

  for (const secret of secrets) {
    const trimmed = secret.trim();
    if (trimmed.length < MIN_SECRET_LENGTH) continue;
    const pattern = new RegExp(escapeRegExp(trimmed), "g");
    if (pattern.test(output)) {
      reasons.add("known-secret-value");
      output = output.replace(pattern, "[redacted]");
    }
  }

  return { text: output, redacted: reasons.size > 0, reasons: [...reasons] };
}

/** Convenience check used by commit- and output-scan call sites. */
export function containsCredential(text: string, secrets: readonly string[] = []): boolean {
  if (secrets.some((secret) => secret.trim().length >= MIN_SECRET_LENGTH && text.includes(secret.trim()))) {
    return true;
  }
  return PATTERNS.some((entry) => {
    entry.pattern.lastIndex = 0;
    const found = entry.pattern.test(text);
    entry.pattern.lastIndex = 0;
    return found;
  });
}

export const REDACTION_PLACEHOLDER = "[redacted]";
