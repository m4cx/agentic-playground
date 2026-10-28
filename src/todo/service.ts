/**
 * Application service that coordinates todo use cases with persistence.
 */

import {
  addChecklistItem,
  archiveTodo,
  completeTodo,
  createTodo,
  removeDueDate,
  setDueDate,
  toggleChecklistItem,
  type Todo,
} from "./todo.js";
import type { TodoStore } from "./store.js";

export interface CreateTodoInput {
  title: string;
  description?: string;
  dueDate?: string;
}

export class TodoService {
  constructor(private readonly store: TodoStore) {}

  async list(): Promise<readonly Todo[]> {
    return this.store.load();
  }

  async findById(id: string): Promise<Todo | undefined> {
    const todos = await this.store.load();
    return todos.find((t) => t.id === id);
  }

  async create(input: CreateTodoInput): Promise<Todo> {
    const todo = createTodo(input.title, {
      description: input.description,
      dueDate: input.dueDate,
    });
    const todos = await this.store.load();
    await this.store.save([...todos, todo]);
    return todo;
  }

  async complete(id: string): Promise<Todo> {
    return this.update(id, (todo) => completeTodo(todo));
  }

  async addChecklistItem(id: string, text: string): Promise<Todo> {
    return this.update(id, (todo) => addChecklistItem(todo, text));
  }

  async toggleChecklistItem(id: string, itemId: string): Promise<Todo> {
    return this.update(id, (todo) => toggleChecklistItem(todo, itemId));
  }

  async setDueDate(id: string, dueDate: string): Promise<Todo> {
    return this.update(id, (todo) => setDueDate(todo, dueDate));
  }

  async removeDueDate(id: string): Promise<Todo> {
    return this.update(id, (todo) => removeDueDate(todo));
  }

  async archive(id: string): Promise<Todo> {
    return this.update(id, (todo) => archiveTodo(todo));
  }

  private async update(
    id: string,
    transform: (todo: Todo) => Todo,
  ): Promise<Todo> {
    const todos = await this.store.load();
    const index = todos.findIndex((t) => t.id === id);
    if (index === -1) {
      throw new TodoNotFoundError(`Todo ${id} not found.`);
    }
    const todo = todos[index];
    if (todo === undefined) {
      throw new TodoNotFoundError(`Todo ${id} not found.`);
    }
    const updated = transform(todo);
    const next = [...todos];
    next[index] = updated;
    await this.store.save(next);
    return updated;
  }
}

export class TodoNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TodoNotFoundError";
  }
}
