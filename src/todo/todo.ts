/**
 * Pure domain logic for the todo app.
 */

export interface ChecklistItem {
  readonly id: string;
  readonly text: string;
  readonly completed: boolean;
}

export interface Todo {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly completed: boolean;
  readonly dueDate: string | null;
  readonly checklist: readonly ChecklistItem[];
  readonly archived: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class TodoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TodoValidationError";
  }
}

function now(): string {
  return new Date().toISOString();
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

export function createTodo(
  title: string,
  options: { description?: string; dueDate?: string } = {},
): Todo {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    throw new TodoValidationError("Todo title cannot be empty.");
  }

  if (options.dueDate !== undefined && !isValidIsoDate(options.dueDate)) {
    throw new TodoValidationError("Due date must be a valid ISO 8601 date.");
  }

  const timestamp = now();
  return {
    id: generateId(),
    title: trimmed,
    description: (options.description ?? "").trim(),
    completed: false,
    dueDate: options.dueDate ?? null,
    checklist: [],
    archived: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function completeTodo(todo: Todo): Todo {
  if (todo.archived) {
    throw new TodoValidationError("Cannot complete an archived todo.");
  }
  return {
    ...todo,
    completed: true,
    updatedAt: now(),
  };
}

export function addChecklistItem(todo: Todo, text: string): Todo {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new TodoValidationError("Checklist item text cannot be empty.");
  }
  if (todo.archived) {
    throw new TodoValidationError("Cannot modify an archived todo.");
  }

  const item: ChecklistItem = {
    id: generateId(),
    text: trimmed,
    completed: false,
  };
  return {
    ...todo,
    checklist: [...todo.checklist, item],
    updatedAt: now(),
  };
}

export function toggleChecklistItem(todo: Todo, itemId: string): Todo {
  if (todo.archived) {
    throw new TodoValidationError("Cannot modify an archived todo.");
  }

  const item = todo.checklist.find((i) => i.id === itemId);
  if (item === undefined) {
    throw new TodoValidationError(`Checklist item ${itemId} not found.`);
  }

  const updatedChecklist = todo.checklist.map((i) =>
    i.id === itemId ? { ...i, completed: !i.completed } : i,
  );

  return {
    ...todo,
    checklist: updatedChecklist,
    updatedAt: now(),
  };
}

export function setDueDate(todo: Todo, dueDate: string | null): Todo {
  if (todo.archived) {
    throw new TodoValidationError("Cannot modify an archived todo.");
  }
  if (dueDate !== null && !isValidIsoDate(dueDate)) {
    throw new TodoValidationError("Due date must be a valid ISO 8601 date.");
  }

  return {
    ...todo,
    dueDate,
    updatedAt: now(),
  };
}

export function removeDueDate(todo: Todo): Todo {
  return setDueDate(todo, null);
}

export function archiveTodo(todo: Todo): Todo {
  if (!todo.completed) {
    throw new TodoValidationError("Only completed todos can be archived.");
  }
  return {
    ...todo,
    archived: true,
    updatedAt: now(),
  };
}

export function isOverdue(todo: Todo, referenceDate: Date = new Date()): boolean {
  if (todo.dueDate === null || todo.completed || todo.archived) {
    return false;
  }
  return new Date(todo.dueDate).getTime() < referenceDate.getTime();
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/.test(value)) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}
