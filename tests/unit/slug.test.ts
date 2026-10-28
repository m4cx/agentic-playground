import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveSlug, isValidSlug, SLUG_PATTERN } from "../../src/agent/slug.js";

test("derives a kebab-case slug", () => {
  assert.equal(deriveSlug("Fix login timeout"), "fix-login-timeout");
});

test("transliterates non-ASCII characters", () => {
  assert.equal(deriveSlug("Überarbeite die Anmeldung"), "ueberarbeite-die-anmeldung");
});

test("falls back to issue when nothing usable remains", () => {
  assert.equal(deriveSlug("🔥🔥🔥"), "issue");
});

test("truncates long titles at a hyphen boundary", () => {
  const slug = deriveSlug(
    "A very long title that keeps going beyond the configured slug limit and then some",
    50,
  );
  assert.ok(slug.length <= 50);
  assert.equal(slug, "a-very-long-title-that-keeps-going-beyond-the");
  assert.match(slug, SLUG_PATTERN);
});

test("rejects an invalid maximum", () => {
  assert.throws(() => deriveSlug("x", 0), /slugMaxLength/);
  assert.throws(() => deriveSlug("x", 51), /slugMaxLength/);
});

test("isValidSlug enforces the pattern and length", () => {
  assert.equal(isValidSlug("a-b-c"), true);
  assert.equal(isValidSlug("-a"), false);
  assert.equal(isValidSlug("a--b"), false);
  assert.equal(isValidSlug("a".repeat(51)), false);
});
