import { test } from "node:test";
import assert from "node:assert/strict";
import { containsSecret, redact, redactRequired } from "../../src/agent/redact.js";

test("redacts a supplied secret", () => {
  const result = redact("token ghs_abcdefghijk", ["ghs_abcdefghijk"]);
  assert.equal(result.redacted, true);
  assert.equal(result.text, "token [redacted]");
});

test("redacts common token patterns", () => {
  for (const value of [
    "ghs_abcdefghijk",
    "github_pat_abcdefghijk",
    "sk-abcdefghijk",
    "Bearer abcdefghijk",
    "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
  ]) {
    const result = redact(value);
    assert.equal(result.redacted, true, value);
    assert.ok(!result.text.includes("abcdefghijk"));
  }
});

test("leaves ordinary text alone", () => {
  const result = redact("The login timeout is 30 seconds.");
  assert.equal(result.redacted, false);
  assert.equal(result.text, "The login timeout is 30 seconds.");
});

test("detects a secret without exposing it", () => {
  assert.equal(containsSecret("x ghs_abcdefghijk y"), true);
  assert.equal(containsSecret("ordinary text"), false);
});

test("fails when redaction empties a required field", () => {
  assert.throws(() => redactRequired("ghs_abcdefghijk", "summary", ["ghs_abcdefghijk"]), /redaction/);
});
