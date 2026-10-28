import assert from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { FileTodoStore, InMemoryTodoStore } from "../../src/todo/index.js";
import { createTodo } from "../../src/todo/todo.js";

function assertDefined<T>(value: T | undefined, message: string): asserts value is T {
  if (value === undefined) {
    assert.fail(message);
  }
}

describe("InMemoryTodoStore", () => {
  it("returns an empty array when new", async () => {
    const store = new InMemoryTodoStore();
    const todos = await store.load();
    assert.deepStrictEqual(todos, []);
  });

  it("persists todos in memory", async () => {
    const store = new InMemoryTodoStore();
    const todo = createTodo("Buy milk");
    await store.save([todo]);

    const loaded = await store.load();
    assert.deepStrictEqual(loaded, [todo]);
  });
});

describe("FileTodoStore", () => {
  async function tempDir(): Promise<string> {
    return mkdtemp(join(tmpdir(), "todo-store-"));
  }

  it("loads an empty list when the file does not exist", async () => {
    const dir = await tempDir();
    try {
      const store = new FileTodoStore(join(dir, "todos.json"));
      const todos = await store.load();
      assert.deepStrictEqual(todos, []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("round-trips todos through a JSON file", async () => {
    const dir = await tempDir();
    try {
      const store = new FileTodoStore(join(dir, "todos.json"));
      const todo = createTodo("Buy milk", { dueDate: "2026-12-31" });
      await store.save([todo]);

      const loaded = await store.load();
      assert.strictEqual(loaded.length, 1);
      const first = loaded[0];
      assertDefined(first, "expected one todo");
      assert.strictEqual(first.title, "Buy milk");
      assert.strictEqual(first.dueDate, "2026-12-31");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
