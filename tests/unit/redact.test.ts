import assert from "node:assert/strict";
import test from "node:test";

import { containsCredential, redact, REDACTION_PLACEHOLDER } from "../../src/agent/redact.js";

test("GitHub token shapes are redacted", () => {
  const token = `ghp_${"a".repeat(36)}`;
  const result = redact(`token: ${token}`);
  assert.equal(result.redacted, true);
  assert.equal(result.text.includes(token), false);
  assert.match(result.text, /\[redacted\]/);
  assert.ok(result.reasons.includes("github-token"));
});

test("provider keys and fine-grained tokens are redacted", () => {
  const anthropic = `sk-ant-api03-${"b".repeat(30)}`;
  const fineGrained = `github_pat_${"c".repeat(40)}`;
  const result = redact(`${anthropic}\n${fineGrained}`);
  assert.equal(result.redacted, true);
  assert.equal(result.text.includes("b".repeat(30)), false);
  assert.equal(result.text.includes("c".repeat(40)), false);
});

test("a .env assignment keeps the key and removes the value", () => {
  const result = redact("GITHUB_TOKEN=super-secret-value\nDEBUG=true");
  assert.equal(result.redacted, true);
  assert.match(result.text, /GITHUB_TOKEN=\[redacted\]/);
  assert.equal(result.text.includes("super-secret-value"), false);
  assert.match(result.text, /DEBUG=true/);
});

test("a private key block is redacted as a whole", () => {
  const block = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----";
  const result = redact(`before\n${block}\nafter`);
  assert.equal(result.redacted, true);
  assert.equal(result.text.includes("MIIEow"), false);
  assert.match(result.text, /before/);
});

test("a known job secret value is redacted even without a known shape", () => {
  const secret = "plain-looking-but-secret";
  const result = redact(`value is ${secret} here`, [secret]);
  assert.equal(result.redacted, true);
  assert.equal(result.text.includes(secret), false);
  assert.ok(result.reasons.includes("known-secret-value"));
});

test("a non-secret control string is unchanged", () => {
  const text = "Read the contributor guide and update the README.";
  const result = redact(text, ["unrelated-secret-value"]);
  assert.equal(result.redacted, false);
  assert.equal(result.text, text);
  assert.equal(REDACTION_PLACEHOLDER, "[redacted]");
});

test("containsCredential detects patterns and known values", () => {
  assert.equal(containsCredential(`x ghp_${"d".repeat(36)} y`), true);
  assert.equal(containsCredential("known-value-here", ["known-value-here"]), true);
  assert.equal(containsCredential("nothing sensitive"), false);
});

test("redaction is idempotent", () => {
  const first = redact(`token ${`ghp_${"e".repeat(36)}`}`);
  const second = redact(first.text);
  assert.equal(second.text, first.text);
});
