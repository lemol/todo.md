---
title: Add the SQLite source
---
Design: [SQLite source design](../../docs/superpowers/specs/2026-10-19-sqlite-source-design.md).

Build a database-backed list: a `SqliteTodoStore` in a new `src/sqlite` module plus a `sqlite` hub source, so `todo projects add --source sqlite` registers a project the CLI and web app open like any other.

Done when:

- `SqliteTodoStore` passes `runConformance` declaring every capability except `promote` (`promote` fails with `Unsupported`): groups, ordering, comments, cancel and full editing, matching `MemoryTodoStore` semantics.
- `src/sqlite` defines a `SqliteDriver` Effect service (open, run, query, transaction); the CLI provides it from `bun:sqlite` in `src/cli/bin.ts` and wires `sqliteSource` into `sources: [fs, git, jira, sqlite]`. No module outside the apps imports `bun`.
- The schema holds the list, groups, tasks, comments and positions per the design; each mutation is one SQLite transaction (WAL mode, no `.todo.lock`); the file and tables are created empty on first open, titled with the project name.
- The registry entry takes an optional `path:`, defaulting to `~/.todo-md/projects/<name>/todo.db`; the hub expands `~`. `changes` is `watchList` over the database file and its `-wal`, as jira watches `mirror.json`. Removing a project deletes the file only when the hub placed it; a file at a given `path:` is left alone.
- `package.json` gains the `./sqlite` export, `test/boundaries.test.ts` gains the `sqlite` row (`spec`, `hub`, `effect`) and the `cli` row gains `sqlite`, `src/sqlite/README.md` documents the module, and CLI help for `projects add --source sqlite` has descriptions and examples (`test/cli/help.test.ts`).
- `bun run check` passes.
