# sqlite

`@lemol/todo-md/sqlite`. A database-backed list: a `TodoStore` over one SQLite
file plus a `sqlite` hub source, so `todo projects add --source sqlite` registers
a project the CLI and web app open like any other.

> **Status: built.** Passes `runConformance` with every capability except `promote`.
> Each mutation is one SQLite transaction in WAL mode without a lock file.

The behavior is specified in the
[SQLite source design](../../docs/superpowers/specs/2026-10-19-sqlite-source-design.md);
[docs/architecture/sources.md](../../docs/architecture/sources.md) puts it next
to the other sources.

## Building it

All database access goes through the `SqliteDriver` Effect service. The CLI
provides it from `bun:sqlite` via `BunSqliteDriver.layer`:

```ts
const sqliteSource = yield* SqliteSource.make().pipe(
  Effect.provide(BunSqliteDriver.layer),
)
Hub.layer({ home, userHome, sources: [fsSource, gitSource, jiraSource, sqliteSource] })
```

No module outside the apps imports `bun:sqlite` or `bun`.

## Config

```yaml
projects:
  groceries:
    source: sqlite
    path: ~/notes/groceries.db # optional
```

A project **needs a name** to title the list and place the file when `path` is
omitted.

| Key | What it is |
| --- | --- |
| `path` | Optional absolute path to the `.db` file (default: `<home>/projects/<name>/todo.db`). `~` is expanded by the hub |

## Schema

Tables are created empty on first open (`CREATE TABLE IF NOT EXISTS`), and the
list's title is initialized with the project name.

| Table | Columns |
| --- | --- |
| `list` | `id` (PK, CHECK id = 1), `title`, `description`, `last_id` |
| `groups` | `name` (PK), `description`, `position` |
| `tasks` | `id` (PK), `title`, `description`, `status` (`open` / `done`), `outcome`, `group_name`, `position`, `tags` (JSON), `assignee`, `depends_on` (JSON), `completed_at`, `cancelled_reason`, `extra` (JSON) |
| `comments` | `task_id` (FK to `tasks(id)` ON DELETE CASCADE), `position`, `author`, `at`, `body` |

IDs are sequential decimal strings (`"1"`, `"2"`, …) allocated from `list.last_id`
and never reused after `remove`.

Positions are integers:
- Open tasks: contiguous from 0 within `group_name` (`NULL` = ungrouped).
- Done tasks: sequence order of completion (`position DESC` lists newest first).
- Comments: ascending on insert, read newest first (`position DESC`).
- Groups: creation order; created on demand and kept even when empty.

## Transactions, WAL and locking

- **No `.todo.lock` file.** Mutations run in a single write transaction (`BEGIN IMMEDIATE` … `COMMIT` / `ROLLBACK`). SQLite's own file locks serialize concurrent writers.
- **WAL mode.** The database opens with `PRAGMA journal_mode = WAL` and `PRAGMA busy_timeout = 5000`, so readers (like the web UI) do not block writers (like the CLI).
- A failed mutation or validation failure rolls back whole.

## Changes

The source watches the database directory with `watchList(dir, { recursive: false, ignore })`,
ignoring every file except the database file and its `-wal` journal.

## Removal

Removing a project deletes the database file only when the hub placed it in its data
directory (`<home>/projects/<name>/todo.db`). A file at a `path:` the user gave is
left alone.

## Diagnostics

A hand-edited or corrupted row that fails model decoding is omitted from `load()`
and `listDone()`. `diagnostics()` reports it with code `invalid-task`:

```json
{
  "severity": "error",
  "code": "invalid-task",
  "taskId": "1",
  "message": "task 1 does not match the model: ..."
}
```

Calling `get` or attempting a mutation on an invalid task fails with `StoreError`.

## Limits

- **No `promote`.** Database tasks have no separate file to move into; `promote` fails with `Unsupported`.
- **No sync.** SQLite lists are local files.
- **No import.** Creating a list from Markdown is deferred to a follow-up task.
