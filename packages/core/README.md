# @lemol/todo-md-core

Adapter-agnostic todo.md logic. Frontends (the CLI now, a web app later) use
`core`; `core` uses whatever `TodoStore` it is given.

> Status: scaffolded, not implemented yet.

## Contents

`TodoService` is a `Context.Service` whose layer requires a `TodoStore`.

| Method                           | Behavior                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `list(filter)`                   | Open tasks filtered by tag, assignee, group, `ready` / `blocked`; optionally include done.     |
| `next(filter?)`                  | Ready tasks in priority order (spec §1.3).                                                     |
| `show(id)`                       | A task plus the status of each of its dependencies and the tasks it blocks.                    |
| `check()`                        | Model diagnostics (`duplicate-id`, `unknown-dependency`, `self-dependency`, `dependency-cycle`) merged with the store's `diagnostics()`. |
| `add`, `update`, `move`, `complete`, `reopen`, `remove`, `renameGroup`, `comment` | Delegate to the store, with the guards below.            |

**Guards** (applied before any change is made):

- `add` and `update` reject a `dependsOn` that is a self-dependency or creates
  a cycle.
- `remove` refuses when open tasks depend on the task, unless `force` is set.
- Operations missing from the store's `capabilities` fail early with
  `Unsupported`.

## Usage

```ts
program.pipe(
  Effect.provide(TodoService.layer),
  Effect.provide(SomeTodoStore.layer)
)
```

## Testing

Unit tests run against `MemoryTodoStore` from [`spec`](../spec).

## Depends on

- [`spec`](../spec)
- `effect`

It never imports an adapter.

## Not here

- File formats: see [`markdown`](../markdown).
- Storage: see [`fs`](../fs).
- Presentation: see [`cli`](../cli).
