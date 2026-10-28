#!/usr/bin/env node
/**
 * Command-line interface for the todo app.
 *
 * Usage:
 *   todo add "Buy milk" [--due 2026-12-31]
 *   todo list [--all]
 *   todo complete <id>
 *   todo checklist-add <id> "Passport"
 *   todo checklist-toggle <id> <itemId>
 *   todo due <id> 2026-12-31 | unset
 *   todo archive <id>
 */

import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import { FileTodoStore, TodoService } from "./index.js";

const DEFAULT_STORE_PATH = join(homedir(), ".todo-app.json");

async function main(argv: string[]): Promise<void> {
  const service = new TodoService(new FileTodoStore(DEFAULT_STORE_PATH));

  const {
    positionals,
    values,
  } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      due: { type: "string" },
      all: { type: "boolean", default: false },
      description: { type: "string" },
    },
  });

  const command = positionals[0];
  if (!command || command === "--help" || command === "help") {
    printUsage();
    process.exit(command ? 0 : 1);
  }

  switch (command) {
    case "add": {
      const title = positionals[1];
      if (!title) {
        throw new Error("Title is required.");
      }
      const todo = await service.create({
        title,
        description: values.description,
        dueDate: values.due,
      });
      console.log(JSON.stringify(todo, null, 2));
      break;
    }

    case "list": {
      const todos = await service.list();
      const filtered = values.all ? todos : todos.filter((t) => !t.archived);
      console.log(JSON.stringify(filtered, null, 2));
      break;
    }

    case "complete": {
      const id = positionals[1];
      if (!id) {
        throw new Error("Todo id is required.");
      }
      const todo = await service.complete(id);
      console.log(JSON.stringify(todo, null, 2));
      break;
    }

    case "checklist-add": {
      const id = positionals[1];
      const text = positionals[2];
      if (!id || !text) {
        throw new Error("Todo id and checklist item text are required.");
      }
      const todo = await service.addChecklistItem(id, text);
      console.log(JSON.stringify(todo, null, 2));
      break;
    }

    case "checklist-toggle": {
      const id = positionals[1];
      const itemId = positionals[2];
      if (!id || !itemId) {
        throw new Error("Todo id and checklist item id are required.");
      }
      const todo = await service.toggleChecklistItem(id, itemId);
      console.log(JSON.stringify(todo, null, 2));
      break;
    }

    case "due": {
      const id = positionals[1];
      const due = positionals[2];
      if (!id) {
        throw new Error("Todo id is required.");
      }
      const todo = due === "unset" || due === undefined
        ? await service.removeDueDate(id)
        : await service.setDueDate(id, due);
      console.log(JSON.stringify(todo, null, 2));
      break;
    }

    case "archive": {
      const id = positionals[1];
      if (!id) {
        throw new Error("Todo id is required.");
      }
      const todo = await service.archive(id);
      console.log(JSON.stringify(todo, null, 2));
      break;
    }

    default: {
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
    }
  }
}

function printUsage(): void {
  console.log(`
Usage:
  todo add "TITLE" [--due ISO_DATE] [--description TEXT]
  todo list [--all]
  todo complete ID
  todo checklist-add ID TEXT
  todo checklist-toggle ID ITEM_ID
  todo due ID ISO_DATE | unset
  todo archive ID
`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
