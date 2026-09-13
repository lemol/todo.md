# The contract: `TodoStore`

`TodoStore` is an Effect service (`Context.Service`) defined in `spec`. Its
methods are the Part 1 operations of the [spec](../spec.md), one to one:

```ts
export class TodoStore extends Context.Service<TodoStore, {
  readonly capabilities: Capabilities
  load(): Effect<TodoList, StoreError>
  get(id: TaskId): Effect<Task, TaskNotFound | StoreError>
  listDone(): Effect<ReadonlyArray<Task>, StoreError>
  add(input: TaskInput, placement?: Placement): Effect<Task, ValidationError | TaskNotFound | Unsupported | StoreError>
  update(id: TaskId, patch: TaskPatch): Effect<Task, TaskNotFound | ValidationError | StoreError>
  move(id: TaskId, placement: Placement): Effect<Task, TaskNotFound | InvalidTransition | ValidationError | Unsupported | StoreError>
  complete(id: TaskId): Effect<Task, TaskNotFound | InvalidTransition | StoreError>
  reopen(id: TaskId): Effect<Task, TaskNotFound | InvalidTransition | StoreError>
  remove(id: TaskId): Effect<void, TaskNotFound | StoreError>
  renameGroup(from: string, to: string): Effect<void, GroupNotFound | ValidationError | Unsupported | StoreError>
  comment(id: TaskId, input: CommentInput): Effect<Comment, TaskNotFound | ValidationError | Unsupported | StoreError>
  diagnostics(): Effect<ReadonlyArray<Diagnostic>, StoreError>
}>()("@lemol/todo-md/spec/TodoStore") {}
```

(Abridged: `Effect<…>` stands for `Effect.Effect<…>`. The source of truth is
[`src/spec/TodoStore.ts`](../../src/spec/TodoStore.ts).)

- **Operations are fine-grained.** A Jira adapter maps each one to an API
  call, and a file adapter maps each one to a read-modify-write.
- **`diagnostics()`** returns format-level issues found while reading, such as
  broken links. An adapter with nothing to report returns an empty array.
- **Model-level checks are shared, not duplicated per adapter.** Stores must
  reject self-dependencies and cycles on `add`/`update` (spec §1.6), and all
  of them use `ensureAcyclic` from `spec` to do it. Reporting existing
  problems (`check`: unknown dependencies, duplicate IDs, cycles introduced by
  hand edits) lives in `core`.

## Capabilities

A store declares which optional operations it supports (spec §1.5):
`groups`, `reorder`, `renameGroup` and `comments`. `core` fails early with
`Unsupported` for the rest, before the store is called, and frontends hide
what a store can't do.

Planned (task 13): `add` and `remove` become capabilities too, so a Jira
source can leave them out.

## Reference implementation and conformance

- **`MemoryTodoStore`** (in `spec`) is the simplest executable statement of the
  operation semantics. `core`'s tests run against it.
- **The conformance suite** (in `spec`) is a list of runner-agnostic cases,
  each an Effect that runs against a fresh store and asserts with
  `node:assert`. `runConformance(name, layer)` registers them with
  `bun:test`. Every adapter's test suite calls it, and `MemoryTodoStore`
  passes it too. The spec's operation semantics are therefore tested, not
  only written down. Cases list the capabilities they `require`, and are
  skipped for stores that lack them.

## Writing an adapter

A new adapter implements `TodoStore` from `@lemol/todo-md/spec`, declares its
capabilities, and runs `runConformance` from `@lemol/todo-md/spec/testing`.
It can be a new module here or live in another repository.

Apps choose adapters at the composition root today. Once the hub exists, an
adapter reaches the frontends by also exporting a `Source` (see
[sources.md](./sources.md)), which apps pass to the hub.
