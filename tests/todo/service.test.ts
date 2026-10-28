import assert from "node:assert";
import { describe, it } from "node:test";
import { InMemoryTodoStore, TodoService, TodoNotFoundError } from "../../src/todo/index.js";

function assertDefined<T>(value: T | undefined, message: string): asserts value is T {
  if (value === undefined) {
    assert.fail(message);
  }
}

describe("TodoService", () => {
  async function makeService(): Promise<{ service: TodoService; store: InMemoryTodoStore }> {
    const store = new InMemoryTodoStore();
    const service = new TodoService(store);
    return { service, store };
  }

  it("creates and lists todos", async () => {
    const { service } = await makeService();
    const todo = await service.create({ title: "Buy milk" });

    const list = await service.list();
    assert.strictEqual(list.length, 1);
    const first = list[0];
    assertDefined(first, "expected at least one todo");
    assert.strictEqual(first.id, todo.id);
  });

  it("finds a todo by id", async () => {
    const { service } = await makeService();
    const created = await service.create({ title: "Buy milk" });

    const found = await service.findById(created.id);
    assertDefined(found, "expected todo to be found");
    assert.strictEqual(found.title, "Buy milk");
  });

  it("throws when a todo is not found", async () => {
    const { service } = await makeService();
    await assert.rejects(service.complete("missing"), TodoNotFoundError);
  });

  it("completes a todo", async () => {
    const { service } = await makeService();
    const created = await service.create({ title: "Buy milk" });

    const completed = await service.complete(created.id);
    assert.strictEqual(completed.completed, true);
  });

  it("adds and toggles checklist items", async () => {
    const { service } = await makeService();
    const created = await service.create({ title: "Pack bags" });

    const withItem = await service.addChecklistItem(created.id, "Passport");
    const item = withItem.checklist[0];
    assertDefined(item, "expected a checklist item");

    const toggled = await service.toggleChecklistItem(created.id, item.id);
    const toggledItem = toggled.checklist[0];
    assertDefined(toggledItem, "expected a checklist item");
    assert.strictEqual(toggledItem.completed, true);
  });

  it("sets and removes a due date", async () => {
    const { service } = await makeService();
    const created = await service.create({ title: "Buy milk" });

    const withDate = await service.setDueDate(created.id, "2026-12-31");
    assert.strictEqual(withDate.dueDate, "2026-12-31");

    const withoutDate = await service.removeDueDate(created.id);
    assert.strictEqual(withoutDate.dueDate, null);
  });

  it("archives a completed todo", async () => {
    const { service } = await makeService();
    const created = await service.create({ title: "Buy milk" });
    await service.complete(created.id);

    const archived = await service.archive(created.id);
    assert.strictEqual(archived.archived, true);
  });

  it("persists changes across service instances", async () => {
    const store = new InMemoryTodoStore();
    const first = new TodoService(store);
    const created = await first.create({ title: "Buy milk" });

    const second = new TodoService(store);
    const found = await second.findById(created.id);
    assertDefined(found, "expected todo to be found");
    assert.strictEqual(found.title, "Buy milk");
  });
});
