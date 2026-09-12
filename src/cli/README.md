# @lemol/todo-md/cli

The `todo` command: manage a todo.md list from the terminal or from an agent.
Built with `effect/unstable/cli` on `@effect/platform-bun`.

> Status: scaffolded, not implemented yet. The binary is not wired up yet.

## Commands

| Command                                   | Does                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| `todo init [dir]`                         | Create a list (default: `./todo/`).                                       |
| `todo` / `todo list` / `todo ls`          | Show open tasks by group. Filters: `--tag`, `--assignee`, `--group`, `--ready`, `--blocked`, `--done`, `--all`. |
| `todo show <id>`                          | Show a task, its dependencies and the tasks it blocks.                    |
| `todo add <title>`                        | Add a task. Options: `--group`, `--tag` (repeatable), `--assignee`, `--depends-on` (repeatable), `--description`, `--before` / `--after`, `--file`. |
| `todo edit <id>`                          | Change a task: `--title`, `--tag` / `--untag`, `--assignee` / `--unassign`, `--depends-on` / `--no-depends-on`, `--description`, `--file`. |
| `todo done <id>...`                       | Complete tasks.                                                           |
| `todo reopen <id>`                        | Reopen a done task.                                                       |
| `todo mv <id>`                            | Move a task: `--group`, `--before <id>`, `--after <id>`, `--top`, `--bottom`. |
| `todo rm <id>`                            | Delete a task (`--force` if others depend on it).                         |
| `todo comment <id> <text>`                | Add a comment. The text can also come from stdin.                         |
| `todo next`                               | Ready tasks in priority order: "what should I work on?"                   |
| `todo check`                              | Validate the list and print its diagnostics.                              |
| `todo fmt`                                | Normalize the list: assign IDs, sweep `[x]` items, sync link text.        |

## Global flags

| Flag              | Meaning                                                                              |
| ----------------- | ------------------------------------------------------------------------------------ |
| `--dir <path>`    | Use this list root instead of discovering one.                                       |
| `--json`          | Print one JSON document to stdout; diagnostics go to stderr.                         |
| `--author <name>` | Comment author. Falls back to `$TODO_MD_AUTHOR`, then the OS user name.              |

## For agents

- **Scriptable output:** `--json` works on every command, and the CLI never
  prompts when stdin is not a TTY.
- **Exit codes:** `0` success, `1` domain error (not found, validation, or
  `check` found errors), `2` usage error.
- **Hand edits are safe:** agents may edit `TODO.md` and task files directly.
  The next command normalizes them.

## May import (enforced by `test/boundaries.test.ts`)

- [`core`](../core)
- [`fs`](../fs)
- [`spec`](../spec)
- `effect`
- `@effect/platform-bun`

The CLI is the composition root: it wires `FsTodoStore` into `TodoService`.
