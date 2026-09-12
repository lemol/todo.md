# @lemol/todo-md/core

Adapter-agnostic todo.md logic. Frontends (the CLI now, a web app later) use
`core`; `core` uses whatever `TodoStore` it is given.

> Status: implemented for spec 0.1.

## Contents

`TodoService` is a `Context.Service`. `TodoService.layer` requires a
`TodoStore`.

| Method | Behavior |
| --- | --- |
| `list(filter?)` | A `Listing`: title, description, every section (ungrouped first) with its matching open tasks, and matching done tasks (most recent first) when `status` is `"done"` or `"all"`. |
| `next(filter?)` | Ready open tasks in priority order (spec §1.3): "what should I work on?" |
| `show(id)` | A `TaskDetail`: the task with its state, each dependency's title and state (`"unknown"` for missing IDs), and the open tasks it blocks. |
| `check()` | The store's diagnostics plus the model checks of spec §1.6 (`duplicate-id`, `unknown-dependency`, `self-dependency`, `dependency-cycle`), skipping any the store already reported. |
| `complete(id)` | A `Completion`: the done task, and the open tasks it made ready. |
| `remove(id, { force? })` | Fails with `HasDependents` while open tasks depend on the task, unless `force`. |
| `add`, `update`, `move`, `reopen`, `renameGroup`, `comment` | Delegate to the store, after the capability guard. |

**Views.** Every task comes back as a `TaskView`:

- `task`: the task itself;
- `state`: `"ready"`, `"blocked"` or `"done"`;
- `blockedBy`: the dependencies that are not done yet, including unknown IDs.

**Filters.** A `TaskFilter` can set:

- `status`: `"open"` (the default), `"done"` or `"all"`;
- `state`: `"ready"` or `"blocked"`;
- `tags`: the task must have all of them;
- `assignee`;
- `group`.

**Capability guard.** Operations the store's capabilities don't include
(spec §1.5) fail with `Unsupported` before the store is called:

- a placement that names a group needs `groups`;
- anchors and `move` need `reorder`;
- `renameGroup` needs `renameGroup`;
- `comment` needs `comments`.

**Cycles.** Rejecting a new self-dependency or cycle is the store's job
(spec §1.6, covered by the conformance suite), so `core` does not repeat it.
`check()` reports cycles that already exist, for example from hand edits.

The pure building blocks are exported too: `viewOf`, `boardOf`,
`inPriorityOrder`, `matches`, `modelDiagnostics` and `mergeDiagnostics`.

## Usage

```ts
program.pipe(
  Effect.provide(TodoService.layer),
  Effect.provide(SomeTodoStore.layer),
)
```

## Testing

- The pure parts (views, filters, checks) have unit tests.
- `TodoService` is tested against `MemoryTodoStore`, plus a wrapped store
  with no optional capabilities, to prove the guard fails before the store is
  called.

## May import (enforced by `test/boundaries.test.ts`)

- [`spec`](../spec)
- `effect`

It never imports an adapter.

## Not here

- File formats: see [`markdown`](../markdown).
- Storage: see [`fs`](../fs).
- Presentation: see [`cli`](../cli).
