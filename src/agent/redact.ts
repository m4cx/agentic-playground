import { AgentError } from "./errors.js";

const SECRET_PATTERNS: RegExp[] = [
  /\bghs_[A-Za-z0-9_]{8,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{8,}\b/g,
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
];

export interface RedactionResult {
  text: string;
  redacted: boolean;
}

export function redact(input: string, secrets: readonly string[] = []): RedactionResult {
  let text = input;
  let redacted = false;

  for (const secret of secrets) {
    if (secret.length === 0) {
      continue;
    }
    const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(escaped, "g");
    if (pattern.test(text)) {
      text = text.replace(pattern, "[redacted]");
      redacted = true;
    }
  }

  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      pattern.lastIndex = 0;
      text = text.replace(pattern, "[redacted]");
      redacted = true;
    }
  }

  return { text, redacted };
}

export function redactRequired(
  input: string,
  field: string,
  secrets: readonly string[] = [],
): string {
  const result = redact(input, secrets);
  const meaningful = result.text.replace(/\[redacted\]/g, "").trim();
  if (result.redacted && meaningful.length === 0) {
    throw new AgentError("redaction", `${field} became empty after redaction`);
  }
  return result.text;
}

export function containsSecret(input: string, secrets: readonly string[] = []): boolean {
  return redact(input, secrets).redacted;
}
