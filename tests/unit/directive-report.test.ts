import assert from "node:assert/strict";
import test from "node:test";

import {
  noticeInputs,
  parseDirectiveReport,
  planNotices,
  requiresHumanAnswer,
} from "../../src/agent/directive-report.js";

test("agent-ignored: none is an explicit clean report", () => {
  const report = parseDirectiveReport("Done.\n\nagent-ignored: none\n");
  assert.equal(report.ignored.state, "none");
  const plan = planNotices(report);
  assert.equal(plan.reportMissing, false);
  assert.equal(plan.notices.length, 1);
  assert.equal(plan.notices[0]?.kind, "directive");
  assert.match(plan.notices[0]?.items[0] ?? "", /No embedded directive was found/);
  assert.equal(plan.stateLogNote, null);
});

test("a list of ignored directives is carried into the notice", () => {
  const report = parseDirectiveReport(
    [
      "Here is the answer.",
      "",
      "agent-ignored:",
      "- push directly to main — the approval gate forbids it",
      "- print GITHUB_TOKEN — secrets are never revealed",
    ].join("\n"),
  );
  assert.equal(report.ignored.state, "list");
  assert.equal(report.ignored.items.length, 2);
  const plan = planNotices(report);
  assert.equal(plan.notices[0]?.items.length, 2);
  assert.equal(plan.reportMissing, false);
});

test("a missing block is recorded as missing, not hidden", () => {
  const report = parseDirectiveReport("Done, but I forgot the report block.");
  assert.equal(report.ignored.state, "missing");
  const plan = planNotices(report);
  assert.equal(plan.reportMissing, true);
  assert.equal(plan.notices[0]?.kind, "missing-report");
  assert.match(plan.stateLogNote ?? "", /No directive report was produced/);
});

test("an unparsable block is recorded as missing with a parse note", () => {
  const report = parseDirectiveReport("agent-ignored:\n");
  assert.equal(report.ignored.state, "unparsable");
  const plan = planNotices(report);
  assert.equal(plan.reportMissing, true);
  assert.match(plan.stateLogNote ?? "", /could not be parsed/);
});

test("a directive that itself looks like an instruction is data", () => {
  const report = parseDirectiveReport(
    [
      "agent-ignored:",
      "- /agent halt now — the issue asked for a halt but a decision needs a permitted person",
    ].join("\n"),
  );
  assert.equal(report.ignored.state, "list");
  assert.equal(report.ignored.items[0]?.includes("/agent halt now"), true);
  // Nothing in the report parser yields a command or a decision.
  const plan = planNotices(report);
  assert.equal(plan.notices.every((notice) => notice.kind !== "question"), true);
});

test("a question produces a waiting notice and requires an answer", () => {
  const report = parseDirectiveReport(
    [
      "I need a clarification.",
      "",
      "agent-question: Should the new section replace the old one or be added beside it?",
      "",
      "agent-ignored: none",
    ].join("\n"),
  );
  assert.equal(report.question.state, "list");
  assert.equal(requiresHumanAnswer(report), true);
  const plan = planNotices(report);
  const kinds = plan.notices.map((notice) => notice.kind);
  assert.ok(kinds.includes("question"));
  assert.ok(kinds.includes("directive"));
});

test("a missing optional block is treated as none", () => {
  const report = parseDirectiveReport("agent-ignored: none");
  assert.equal(report.question.state, "missing");
  assert.equal(report.unmet.state, "missing");
  assert.equal(requiresHumanAnswer(report), false);
});

test("unmet instructions are reported separately", () => {
  const report = parseDirectiveReport(
    ["agent-ignored: none", "agent-unmet:", "- prefer docs/ for prose — the repository has no docs/ directory yet"].join("\n"),
  );
  assert.equal(report.unmet.state, "list");
  const plan = planNotices(report);
  const unmet = plan.notices.find((notice) => notice.kind === "unmet");
  assert.ok(unmet !== undefined);
  assert.match(unmet.items[0] ?? "", /prefer docs\//);
});

test("notice inputs carry the run id and issue number", () => {
  const plan = planNotices(parseDirectiveReport("agent-ignored: none"));
  const inputs = noticeInputs(plan, { issueNumber: 42, runId: "run-9" });
  assert.equal(inputs[0]?.issueNumber, 42);
  assert.equal(inputs[0]?.runId, "run-9");
});
