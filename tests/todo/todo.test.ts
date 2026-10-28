import assert from "node:assert";
import { describe, it } from "node:test";
import {
  addChecklistItem,
  archiveTodo,
  completeTodo,
  createTodo,
  isOverdue,
  removeDueDate,
  setDueDate,
  toggleChecklistItem,
  TodoValidationError,
} from "../../src/todo/todo.js";

describe("createTodo", () => {
  it("creates a todo with a title", () => {
    const todo = createTodo("Buy milk");

    assert.strictEqual(todo.title, "Buy milk");
    assert.strictEqual(todo.completed, false);
    assert.strictEqual(todo.archived, false);
    assert.deepStrictEqual(todo.checklist, []);
    assert.strictEqual(todo.dueDate, null);
    assert.ok(todo.id.length > 0);
  });

  it("trims whitespace from the title", () => {
    const todo = createTodo("  Buy milk  ");
    assert.strictEqual(todo.title, "Buy milk");
  });

  it("rejects an empty title", () => {
    assert.throws(() => createTodo("  "), TodoValidationError);
  });

  it("accepts a due date", () => {
    const todo = createTodo("Buy milk", { dueDate: "2026-12-31" });
    assert.strictEqual(todo.dueDate, "2026-12-31");
  });

  it("rejects an invalid due date", () => {
    assert.throws(
      () => createTodo("Buy milk", { dueDate: "not-a-date" }),
      TodoValidationError,
    );
  });
});

describe("completeTodo", () => {
  it("marks a todo as completed", () => {
    const todo = createTodo("Buy milk");
    const completed = completeTodo(todo);

    assert.strictEqual(completed.completed, true);
    assert.ok(completed.updatedAt >= todo.updatedAt);
  });

  it("cannot complete an archived todo", () => {
    const todo = archiveTodo(completeTodo(createTodo("Buy milk")));
    assert.throws(() => completeTodo(todo), TodoValidationError);
  });
});

describe("checklist", () => {
  it("adds a checklist item", () => {
    const todo = createTodo("Pack bags");
    const withItem = addChecklistItem(todo, "Passport");

    const item = withItem.checklist[0];
    assert.ok(item);
    assert.strictEqual(item.text, "Passport");
    assert.strictEqual(item.completed, false);
  });

  it("rejects empty checklist item text", () => {
    assert.throws(
      () => addChecklistItem(createTodo("Pack bags"), "  "),
      TodoValidationError,
    );
  });

  it("toggles a checklist item", () => {
    let todo = addChecklistItem(createTodo("Pack bags"), "Passport");
    const item = todo.checklist[0];
    assert.ok(item);
    const itemId = item.id;

    todo = toggleChecklistItem(todo, itemId);
    const firstToggle = todo.checklist[0];
    assert.ok(firstToggle);
    assert.strictEqual(firstToggle.completed, true);

    todo = toggleChecklistItem(todo, itemId);
    const secondToggle = todo.checklist[0];
    assert.ok(secondToggle);
    assert.strictEqual(secondToggle.completed, false);
  });

  it("fails to toggle an unknown checklist item", () => {
    assert.throws(
      () => toggleChecklistItem(createTodo("Pack bags"), "missing"),
      TodoValidationError,
    );
  });
});

describe("due date", () => {
  it("sets a due date", () => {
    const todo = setDueDate(createTodo("Buy milk"), "2026-12-31");
    assert.strictEqual(todo.dueDate, "2026-12-31");
  });

  it("removes a due date", () => {
    const todo = removeDueDate(createTodo("Buy milk", { dueDate: "2026-12-31" }));
    assert.strictEqual(todo.dueDate, null);
  });

  it("rejects invalid due dates", () => {
    assert.throws(
      () => setDueDate(createTodo("Buy milk"), "tomorrow"),
      TodoValidationError,
    );
  });
});

describe("archiveTodo", () => {
  it("archives a completed todo", () => {
    const todo = archiveTodo(completeTodo(createTodo("Buy milk")));
    assert.strictEqual(todo.archived, true);
  });

  it("rejects archiving an incomplete todo", () => {
    assert.throws(
      () => archiveTodo(createTodo("Buy milk")),
      TodoValidationError,
    );
  });
});

describe("isOverdue", () => {
  it("returns true when the due date is in the past", () => {
    const todo = createTodo("Buy milk", { dueDate: "2020-01-01" });
    assert.strictEqual(isOverdue(todo, new Date("2021-01-01")), true);
  });

  it("returns false when the due date is in the future", () => {
    const todo = createTodo("Buy milk", { dueDate: "2099-01-01" });
    assert.strictEqual(isOverdue(todo, new Date("2021-01-01")), false);
  });

  it("returns false for completed or archived todos", () => {
    let todo = createTodo("Buy milk", { dueDate: "2020-01-01" });
    assert.strictEqual(isOverdue(completeTodo(todo), new Date("2021-01-01")), false);
    assert.strictEqual(
      isOverdue(archiveTodo(completeTodo(todo)), new Date("2021-01-01")),
      false,
    );
  });
});
