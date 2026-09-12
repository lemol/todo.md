# @lemol/todo-md-spec

The todo.md model and contract as code. It is the Part 1 of the
[spec](../../docs/spec.md#part-1-model-and-operations) that every other
package depends on.

> Status: scaffolded, not implemented yet.

## Contents

| Export              | What it is                                                                              |
| ------------------- | --------------------------------------------------------------------------------------- |
| Model schemas       | `TaskId`, `Task`, `Group`, `TodoList`, `Comment`, `TaskInput`, `TaskPatch`, `Placement` (Effect `Schema`) |
| Errors              | `TaskNotFound`, `GroupNotFound`, `InvalidTransition`, `ValidationError`, `Unsupported`, `StoreError` (`Schema.TaggedError`) |
| `Diagnostic`        | Non-fatal issue found while reading a list (spec §1.6).                                 |
| `Capabilities`      | What a store supports: `groups`, `reorder`, `renameGroup`, `comments` (spec §1.5).      |
| `TodoStore`         | The adapter contract: a `Context.Service` with one method per spec operation.           |
| `MemoryTodoStore`   | The in-memory reference implementation of `TodoStore`.                                  |

The `@lemol/todo-md-spec/testing` entry point is for tests only:

| Export                          | What it is                                                              |
| ------------------------------- | ----------------------------------------------------------------------- |
| `effectTest(name, effect, layer?)` | Runs an Effect as a `bun:test` test, with a scope and test services. |
| `conformanceCases`              | The runner-agnostic conformance cases, each an Effect over a `TodoStore`. |
| `runConformance(layer)`         | Registers every case with `bun:test` for the given store layer.         |

## Writing an adapter

1. Implement `TodoStore` and provide it as a `Layer`.
2. Declare `capabilities` honestly; unsupported operations fail with
   `Unsupported`.
3. In your tests, call `runConformance(YourStore.layer)`.

## Depends on

`effect` only.

## Not here

- Business logic such as readiness, cycle detection and queries: see
  [`core`](../core).
- The Markdown format: see [`markdown`](../markdown).
