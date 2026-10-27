import assert from "node:assert/strict";
import test from "node:test";

import {
  DECISION_WORDS,
  INFORMATIONAL_WORDS,
  extraCommandsText,
  helpText,
  parseCommand,
  unknownCommandText,
} from "../../src/agent/commands.js";

test("each decision word maps to a decision", () => {
  for (const word of DECISION_WORDS) {
    const parsed = parseCommand(`/agent ${word}`);
    assert.equal(parsed?.word, word);
    assert.equal(parsed?.kind, "decision");
  }
});

test("status and help are informational and never decisions", () => {
  for (const word of INFORMATIONAL_WORDS) {
    assert.equal(parseCommand(`/agent ${word}`)?.kind, "informational");
  }
});

test("the word is case-insensitive and the reason is preserved", () => {
  const parsed = parseCommand("/AGENT Halt Please stop after this file");
  assert.equal(parsed?.word, "halt");
  assert.equal(parsed?.kind, "decision");
  assert.equal(parsed?.reason, "Please stop after this file");
});

test("a command must be the first non-whitespace token", () => {
  assert.equal(parseCommand("please /agent halt"), null);
  assert.equal(parseCommand("I think we should /agent halt"), null);
  assert.equal(parseCommand("\n\n   /agent halt\n")?.word, "halt");
  assert.equal(parseCommand("   /agent halt   ")?.word, "halt");
});

test("a fenced command is not a command", () => {
  assert.equal(parseCommand("```\n/agent halt\n```"), null);
  assert.equal(parseCommand("~~~text\n/agent halt\n~~~"), null);
});

test("a quoted mention is not a command", () => {
  assert.equal(parseCommand('> "/agent halt" is the emergency brake'), null);
});

test("a bare /agent is an unknown command", () => {
  const parsed = parseCommand("/agent");
  assert.equal(parsed?.word, "");
  assert.equal(parsed?.kind, "unknown");
  assert.match(unknownCommandText(""), /without a command word/);
});

test("an unknown word changes nothing and produces help", () => {
  const parsed = parseCommand("/agent deploy");
  assert.equal(parsed?.kind, "unknown");
  assert.match(unknownCommandText("deploy"), /is not a command; nothing changed/);
  assert.match(unknownCommandText("deploy"), /\/agent halt/);
});

test("the first of several commands wins and the rest are listed", () => {
  const parsed = parseCommand("/agent halt\n/agent retry");
  assert.equal(parsed?.word, "halt");
  assert.deepEqual(parsed?.extraWords, ["retry"]);
  assert.match(extraCommandsText(["retry"]), /Only the first command/);
  assert.equal(extraCommandsText([]), "");
});

test("a multi-line reason is kept verbatim", () => {
  const parsed = parseCommand("/agent reject\nbecause the approach is wrong\nand the diff is too big");
  assert.equal(parsed?.word, "reject");
  assert.match(parsed?.reason ?? "", /because the approach is wrong/);
});

test("help text lists every command", () => {
  const help = helpText();
  for (const word of [...DECISION_WORDS, ...INFORMATIONAL_WORDS]) {
    assert.match(help, new RegExp(`/agent ${word}`));
  }
});

test("an empty body is not a command", () => {
  assert.equal(parseCommand(""), null);
  assert.equal(parseCommand(null), null);
  assert.equal(parseCommand("ordinary conversation"), null);
});
