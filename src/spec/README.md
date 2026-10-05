# @lemol/todo-md/spec

The todo.md model and contract as code: Part 1 of the
[spec](../../docs/spec.md#part-1-model-and-operations) that every other
module depends on.

> Status: implemented for spec 0.1.

## Contents

| Export              | What it is                                                                              |
| ------------------- | --------------------------------------------------------------------------------------- |
| Model schemas       | `TaskId`, `Task`, `Group`, `TodoList`, `Comment`, `TaskInput`, `TaskPatch`, `Placement` (Effect `Schema`) |
| Errors              | `TaskNotFound`, `GroupNotFound`, `InvalidTransition`, `ValidationError`, `Unsupported`, `StoreError` (`Schema.TaggedError`) |
| `Diagnostic`        | Non-fatal issue found while reading a list (spec §1.6).                                 |
| `Capabilities`      | What a store supports: `groups`, `reorder`, `renameGroup`, `comments`, `promote`, `cancel`, `add`, `remove`, `edit`, `commentAuthor` (spec §1.5). |
| `TodoStore`         | The adapter contract: a `Context.Service` with one method per spec operation.           |
| `MemoryTodoStore`   | The in-memory reference implementation of `TodoStore`.                                  |
| Helpers             | `findCycle`, `validate` (schema decode → `ValidationError`), `ensureAcyclic`, `unique`, for adapters and `core`. |
| `TaskRef`, `parseRef`, `formatRef`, `isValidName` | Task references as typed: `<project>:<id>`, or a bare ID in the current project. |
| `makeLock(root, options?)`, `Lock`, `defaultLockOptions`, `lockFile` | A directory's advisory lock: `<root>/.todo.lock`, created exclusively. `makeLock` returns a `Lock`, a function that runs an effect while holding it and fails with `StoreError` after `timeout`. It lives here so every adapter can take it: `fs` (and so the hub and git, through it) and `jira`, which may not import `fs`. |

The `@lemol/todo-md/spec/testing` entry point is for tests only:

| Export                          | What it is                                                              |
| ------------------------------- | ----------------------------------------------------------------------- |
| `effectTest(name, effect, layer?)` | Runs an Effect as a `bun:test` test, with a scope and test services. |
| `conformanceCases`              | The runner-agnostic conformance cases, each an Effect over a `TodoStore`. They assert with `node:assert`, so they need no particular test runner. |
| `equal`, `failsWith`, `layout`  | The assertion helpers the cases use, for adapter-specific tests. |
| `given(...tasks)`               | The state a case starts from: the runner's `seed` when it has one, `add` otherwise. Takes `SeedTask`s (a `TaskInput` plus optional `placement` and `done`). |
| `runConformance(name, layer, options?)` | Registers every case with `bun:test` for the given store layer. `options.seed` is how a store without `add` gets a case's starting state. |

## Writing an adapter

1. Implement `TodoStore` and provide it as a `Layer`.
2. Declare `capabilities` honestly; unsupported operations fail with
   `Unsupported`.
3. In your tests, call `runConformance("YourStore", YourStore.layer)`. The
   layer must build a fresh, empty store each time it is provided.
4. A store without `add` needs a `seed` to be held to the rest of the spec:
   `runConformance("YourStore", YourStore.layer, { seed })`, where `seed`
   puts tasks in the store some other way and returns them with their IDs.
   Cases that need a starting state and have neither are skipped.

## May import (enforced by `test/boundaries.test.ts`)

`effect` only. The `testing` entry point may also import `bun:test` and
`node:assert`, and runtime code never imports it.

## Not here

- Business logic such as readiness, cycle detection and queries: see
  [`core`](../core).
- The Markdown format: see [`markdown`](../markdown).
