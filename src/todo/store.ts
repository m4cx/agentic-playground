/**
 * JSON file persistence for todos.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Todo } from "./todo.js";

export interface TodoStore {
  load(): Promise<readonly Todo[]>;
  save(todos: readonly Todo[]): Promise<void>;
}

export class FileTodoStore implements TodoStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<readonly Todo[]> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed as readonly Todo[];
    } catch (error) {
      if (isENOENT(error)) {
        return [];
      }
      throw error;
    }
  }

  async save(todos: readonly Todo[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(
      this.filePath,
      JSON.stringify(todos, null, 2),
      "utf-8",
    );
  }
}

function isENOENT(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export class InMemoryTodoStore implements TodoStore {
  private todos: Todo[] = [];

  async load(): Promise<readonly Todo[]> {
    return [...this.todos];
  }

  async save(todos: readonly Todo[]): Promise<void> {
    this.todos = [...todos];
  }
}
