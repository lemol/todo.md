# spec Module Implementation Plan (Plan 1 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `@lemol/todo-md/spec`, the model schemas, errors, `TodoStore` contract and in-memory reference store, together with `@lemol/todo-md/spec/testing`, the test helpers and the conformance suite every adapter runs.

**Architecture:** The model is Effect `Schema` structs, so stores validate input by decoding it. `TodoStore` is a `Context.Service` with one method per operation in spec §1.4. The conformance suite is a list of runner-agnostic Effects (assertions via `node:assert`), and `runConformance` registers them with `bun:test`. `MemoryTodoStore` keeps the list in a `SynchronizedRef` and runs every mutation as a transaction, so a failed operation changes nothing.

**Tech Stack:** Bun 1.4, TypeScript 7, Effect `4.0.0-rc.108` (`effect`, `effect/testing`), `bun:test`, Biome.

**Spec:**
- [`docs/spec.md`](../../spec.md) Part 1 (§1.1–§1.6): what this plan implements.
- [`docs/architecture.md`](../../architecture.md): module rules.
- [`src/spec/README.md`](../../../src/spec/README.md): this module's contents.

**Where this plan sits:** it is the first of five plans, one per module, in build order:

1. `spec` (this plan)
2. `markdown`: parse and minimal-diff writer for the file format (spec Part 2)
3. `fs`: `FsTodoStore`, which must pass the conformance suite built here
4. `core`: `TodoService` queries, `check`, guards
5. `cli`: the `todo` command

Each later plan is written after the previous one lands, against the real interfaces.

## Global Constraints

- **Effect version.** `effect` is pinned to exactly `4.0.0-rc.108` (peer + dev dependency). Do not add dependencies.
- **Read the Effect guide first.** Before writing Effect code, read `node_modules/effect/AGENTS.md` completely. For API details, search `node_modules/effect/src`.
- **Module graph** (enforced by `test/boundaries.test.ts`):
  - `src/spec/**` may import only `effect` (including subpaths such as `effect/testing`) and other files in `src/spec`.
  - Files under `src/spec/testing*` may additionally import `bun:test` and `node:assert`.
  - Runtime files must never import `src/spec/testing*`.
- **Imports.** Imports inside `src/` are relative and end in `.ts` (`import { Task } from "./model.ts"`). Never import through `@lemol/todo-md/...` from inside `src/`.
- **Tests** live in `test/spec/` and use `bun:test`.
- **Formatting.** Biome: double quotes, no semicolons, 2-space indent, line width 100. Run `bun run fix` after editing; code in this plan is already formatted.
- **Gate.** `bun run check` (lint + typecheck + all tests) must pass before every commit.
- **Commits.** Commit messages are plain sentences (the repo's style) ending with:

  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_014ak6bnNqeftYod6YDrWkcK
  ```

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/spec/model.ts` | Schemas and types: `TaskId`, `Label`, `Handle`, `TaskStatus`, `Extra`, `Comment`, `Task`, `Group`, `TodoList`, `TaskInput`, `TaskPatch`, `Placement`, `CommentInput` |
| `src/spec/errors.ts` | Tagged errors: `TaskNotFound`, `GroupNotFound`, `InvalidTransition`, `ValidationError`, `Unsupported`, `StoreError` |
| `src/spec/graph.ts` | `findCycle`: dependency cycle detection shared by stores and `core` |
| `src/spec/validation.ts` | `validate` (schema decode → `ValidationError`), `ensureAcyclic`, `unique` |
| `src/spec/diagnostic.ts` | `Severity`, `Diagnostic` schemas |
| `src/spec/TodoStore.ts` | `Capabilities`, `allCapabilities`, the `TodoStore` service contract |
| `src/spec/MemoryTodoStore.ts` | The in-memory reference store: `layer(options?)` |
| `src/spec/index.ts` | Public entry point `@lemol/todo-md/spec` |
| `src/spec/testing.ts` | Public entry point `@lemol/todo-md/spec/testing` |
| `src/spec/testing/effectTest.ts` | `effectTest`: runs an Effect as a `bun:test` test with `TestClock`/`TestConsole` |
| `src/spec/testing/conformance/case.ts` | `ConformanceCase` type |
| `src/spec/testing/conformance/assert.ts` | `equal`, `failsWith`, `layout` assertion helpers |
| `src/spec/testing/conformance/{reading,adding,updating,moving,lifecycle,groups,comments}.ts` | Conformance cases per operation group |
| `src/spec/testing/conformance/index.ts` | `conformanceCases`, `runConformance` |
| `test/spec/*.test.ts` | Tests for each file above |

`src/spec/index.ts` and `src/spec/testing.ts` exist today as `export {}` placeholders. `package.json` already exports both paths.

---

### Task 1: Model schemas

**Files:**
- Modify: `tsconfig.json` (allow `.ts` import extensions)
- Create: `src/spec/model.ts`
- Test: `test/spec/model.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (all exported from `src/spec/model.ts`; each is a schema plus a same-named type):
  - `TaskId` (non-empty string).
  - `Label` (trimmed, non-empty, single line).
  - `Handle` (no whitespace).
  - `TaskStatus` (`"open" | "done"`).
  - `Extra` (`Record<string, unknown>`).
  - `Comment` `{ author, at: DateTime.Utc, body }`.
  - `Task` `{ id, title, description, status, tags, assignee?, dependsOn, comments, group?, completedAt?, extra }`.
  - `Group` `{ name, description, tasks }`.
  - `TodoList` `{ title, description, ungrouped, groups }`.
  - `TaskInput` `{ title, description?, tags?, assignee?, dependsOn?, extra? }`.
  - `TaskPatch` `{ title?, description?, tags?, assignee?: Label | null, dependsOn?, extra? }`.
  - `Placement` `{ group?, before?, after? }`.
  - `CommentInput` `{ author, body }`.

- [ ] **Step 1: Allow `.ts` import extensions**

In `tsconfig.json`, add `"allowImportingTsExtensions": true,` directly after `"verbatimModuleSyntax": true,`. The file does not emit, so this is safe; without it, `tsc` rejects `import ... from "./model.ts"` with TS5097.

- [ ] **Step 2: Write the failing test**

Create `test/spec/model.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { CommentInput, Label, TaskInput, TaskPatch } from "../../src/spec/model.ts"

const accepts = <S extends Schema.Top>(schema: S, value: unknown) =>
  expect(Schema.is(schema)(value)).toBe(true)
const rejects = <S extends Schema.Top>(schema: S, value: unknown) =>
  expect(Schema.is(schema)(value)).toBe(false)

describe("Label", () => {
  test("accepts non-empty single-line trimmed text", () => {
    accepts(Label, "Fix login redirect")
    accepts(Label, "API & Auth")
  })

  test("rejects empty, multi-line or padded text", () => {
    rejects(Label, "")
    rejects(Label, "two\nlines")
    rejects(Label, " padded ")
  })
})

describe("TaskInput", () => {
  test("requires only a title", () => {
    accepts(TaskInput, { title: "Write changelog" })
  })

  test("rejects a missing title and empty tags", () => {
    rejects(TaskInput, {})
    rejects(TaskInput, { title: "x", tags: [""] })
  })
})

describe("TaskPatch", () => {
  test("accepts null to clear the assignee", () => {
    accepts(TaskPatch, { assignee: null })
  })
})

describe("CommentInput", () => {
  test("requires a handle without whitespace and a non-empty body", () => {
    accepts(CommentInput, { author: "lemol", body: "Started." })
    rejects(CommentInput, { author: "le mol", body: "Started." })
    rejects(CommentInput, { author: "lemol", body: "" })
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test test/spec/model.test.ts`
Expected: FAIL with `Cannot find module '../../src/spec/model.ts'`.

- [ ] **Step 4: Write the model**

Create `src/spec/model.ts`:

```ts
import { Schema } from "effect"

const singleLine = Schema.isPattern(/^[^\r\n]*$/, { expected: "a single line" })
const noWhitespace = Schema.isPattern(/^\S+$/, { expected: "a value without whitespace" })

/** Opaque task identifier (spec §1.2). The file-system format uses decimal integers ("7"). */
export const TaskId = Schema.NonEmptyString
export type TaskId = typeof TaskId.Type

/** Non-empty, single-line text without surrounding whitespace: titles, names, tags. */
export const Label = Schema.Trimmed.check(Schema.isNonEmpty(), singleLine)
export type Label = typeof Label.Type

/** A person or agent handle: non-empty, no whitespace (spec §1.1, Comment.author). */
export const Handle = Schema.String.check(noWhitespace)
export type Handle = typeof Handle.Type

export const TaskStatus = Schema.Literals(["open", "done"])
export type TaskStatus = typeof TaskStatus.Type

export const Extra = Schema.Record(Schema.String, Schema.Unknown)
export type Extra = typeof Extra.Type

export const Comment = Schema.Struct({
  author: Handle,
  at: Schema.DateTimeUtc,
  body: Schema.String.check(Schema.isTrimmed(), Schema.isNonEmpty()),
})
export type Comment = typeof Comment.Type

export const Task = Schema.Struct({
  id: TaskId,
  title: Label,
  description: Schema.String,
  status: TaskStatus,
  tags: Schema.Array(Label),
  assignee: Schema.optional(Label),
  dependsOn: Schema.Array(TaskId),
  comments: Schema.Array(Comment),
  group: Schema.optional(Label),
  completedAt: Schema.optional(Schema.DateTimeUtc),
  extra: Extra,
})
export type Task = typeof Task.Type

export const Group = Schema.Struct({
  name: Label,
  description: Schema.String,
  tasks: Schema.Array(Task),
})
export type Group = typeof Group.Type

export const TodoList = Schema.Struct({
  title: Schema.String,
  description: Schema.String,
  ungrouped: Schema.Array(Task),
  groups: Schema.Array(Group),
})
export type TodoList = typeof TodoList.Type

/** Input for `add` (spec §1.4). */
export const TaskInput = Schema.Struct({
  title: Label,
  description: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Label)),
  assignee: Schema.optional(Label),
  dependsOn: Schema.optional(Schema.Array(TaskId)),
  extra: Schema.optional(Extra),
})
export type TaskInput = typeof TaskInput.Type

/** Changes for `update` (spec §1.4). Absent fields are unchanged; `assignee: null` clears it. */
export const TaskPatch = Schema.Struct({
  title: Schema.optional(Label),
  description: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Label)),
  assignee: Schema.optional(Schema.NullOr(Label)),
  dependsOn: Schema.optional(Schema.Array(TaskId)),
  extra: Schema.optional(Extra),
})
export type TaskPatch = typeof TaskPatch.Type

/** Where a task goes (spec §1.4). No group means ungrouped; an anchor decides the group. */
export const Placement = Schema.Struct({
  group: Schema.optional(Label),
  before: Schema.optional(TaskId),
  after: Schema.optional(TaskId),
})
export type Placement = typeof Placement.Type

export const CommentInput = Schema.Struct({
  author: Handle,
  body: Schema.String.check(Schema.isTrimmed(), Schema.isNonEmpty()),
})
export type CommentInput = typeof CommentInput.Type
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test test/spec/model.test.ts`
Expected: `6 pass`, `0 fail`.

- [ ] **Step 6: Run the gate and commit**

```bash
bun run check
git add tsconfig.json src/spec/model.ts test/spec/model.test.ts
git commit -m "Add the todo.md model schemas" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014ak6bnNqeftYod6YDrWkcK"
```

---

### Task 2: Errors, cycle detection and validation helpers

**Files:**
- Create: `src/spec/errors.ts`, `src/spec/graph.ts`, `src/spec/validation.ts`
- Test: `test/spec/graph.test.ts`, `test/spec/validation.test.ts`

**Interfaces:**
- Consumes: `TaskStatus`, `Task`, `TaskId`, `Label` from Task 1.
- Produces:
  - **Errors** (`Schema.TaggedError` classes, constructed with `new X({...})`; they can be yielded directly in `Effect.gen`):
    - `TaskNotFound { id: string }`
    - `GroupNotFound { name: string }`
    - `InvalidTransition { id: string; status: TaskStatus; operation: string }`
    - `ValidationError { issues: ReadonlyArray<string> }`
    - `Unsupported { operation: string }`
    - `StoreError { message: string; cause?: unknown }`
  - `findCycle(edges: ReadonlyMap<TaskId, ReadonlyArray<TaskId>>): ReadonlyArray<TaskId> | undefined`. It returns the cycle path, e.g. `["1", "2", "1"]`, with a self-dependency as `["3", "3"]`.
  - `validate(schema, value): Effect<S["Type"], ValidationError>`
  - `ensureAcyclic(tasks: Iterable<Task>): Effect<void, ValidationError>`. Its message is `dependency cycle: 1 → 2 → 1`.
  - `unique<A>(values: ReadonlyArray<A>): ReadonlyArray<A>`

- [ ] **Step 1: Write the failing tests**

Create `test/spec/graph.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { findCycle } from "../../src/spec/graph.ts"

const graph = (edges: Record<string, string[]>) => new Map(Object.entries(edges))

describe("findCycle", () => {
  test("returns undefined for an acyclic graph", () => {
    expect(findCycle(graph({ "1": [], "2": ["1"], "3": ["1", "2"] }))).toBeUndefined()
  })

  test("reports a self-dependency", () => {
    expect(findCycle(graph({ "3": ["3"] }))).toEqual(["3", "3"])
  })

  test("reports the IDs along a cycle", () => {
    expect(findCycle(graph({ "1": ["2"], "2": ["3"], "3": ["1"] }))).toEqual(["1", "2", "3", "1"])
  })

  test("ignores dependencies on unknown IDs", () => {
    expect(findCycle(graph({ "1": ["9"] }))).toBeUndefined()
  })
})
```

Create `test/spec/validation.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { ValidationError } from "../../src/spec/errors.ts"
import { Label, type Task } from "../../src/spec/model.ts"
import { ensureAcyclic, unique, validate } from "../../src/spec/validation.ts"

const task = (id: string, dependsOn: string[]): Task => ({
  id,
  title: `Task ${id}`,
  description: "",
  status: "open",
  tags: [],
  dependsOn,
  comments: [],
  extra: {},
})

describe("validate", () => {
  test("returns the decoded value", async () => {
    expect(await Effect.runPromise(validate(Label, "Ship it"))).toBe("Ship it")
  })

  test("fails with ValidationError", async () => {
    const error = await Effect.runPromise(Effect.flip(validate(Label, "")))
    expect(error).toBeInstanceOf(ValidationError)
    expect(error.issues).toHaveLength(1)
  })
})

describe("ensureAcyclic", () => {
  test("succeeds without cycles", () => {
    expect(
      Exit.isSuccess(Effect.runSyncExit(ensureAcyclic([task("1", []), task("2", ["1"])]))),
    ).toBe(true)
  })

  test("fails with the cycle in the message", async () => {
    const error = await Effect.runPromise(
      Effect.flip(ensureAcyclic([task("1", ["2"]), task("2", ["1"])])),
    )
    expect(error.issues).toEqual(["dependency cycle: 1 → 2 → 1"])
  })
})

describe("unique", () => {
  test("keeps the first occurrence of each value", () => {
    expect(unique(["a", "b", "a", "c", "b"])).toEqual(["a", "b", "c"])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/spec/graph.test.ts test/spec/validation.test.ts`
Expected: FAIL with `Cannot find module` for `graph.ts` and `validation.ts`.

- [ ] **Step 3: Write the errors**

Create `src/spec/errors.ts`:

```ts
import { Schema } from "effect"
import { TaskStatus } from "./model.ts"

/** No open or done task has this ID. */
export class TaskNotFound extends Schema.TaggedError<TaskNotFound>()("TaskNotFound", {
  id: Schema.String,
}) {}

/** No open group has this name. */
export class GroupNotFound extends Schema.TaggedError<GroupNotFound>()("GroupNotFound", {
  name: Schema.String,
}) {}

/** The operation does not apply to a task in this status, e.g. completing a done task. */
export class InvalidTransition extends Schema.TaggedError<InvalidTransition>()(
  "InvalidTransition",
  { id: Schema.String, status: TaskStatus, operation: Schema.String },
) {}

/** The input, or the list the operation would produce, violates the model. */
export class ValidationError extends Schema.TaggedError<ValidationError>()("ValidationError", {
  issues: Schema.Array(Schema.String),
}) {}

/** The store lacks the capability the operation needs (spec §1.5). */
export class Unsupported extends Schema.TaggedError<Unsupported>()("Unsupported", {
  operation: Schema.String,
}) {}

/** An I/O, network or backend failure. */
export class StoreError extends Schema.TaggedError<StoreError>()("StoreError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}
```

- [ ] **Step 4: Write cycle detection**

Create `src/spec/graph.ts`:

```ts
import type { TaskId } from "./model.ts"

/**
 * Finds a dependency cycle. `edges` maps each task to the tasks it depends on.
 * Returns the IDs along the first cycle found, starting and ending with the same
 * ID (`["1", "2", "1"]`; a self-dependency is `["3", "3"]`), or `undefined`.
 * Dependencies on IDs missing from `edges` are ignored.
 */
export const findCycle = (
  edges: ReadonlyMap<TaskId, ReadonlyArray<TaskId>>,
): ReadonlyArray<TaskId> | undefined => {
  const finished = new Set<TaskId>()
  const path: TaskId[] = []
  const onPath = new Set<TaskId>()

  const visit = (id: TaskId): ReadonlyArray<TaskId> | undefined => {
    if (onPath.has(id)) return [...path.slice(path.indexOf(id)), id]
    if (finished.has(id) || !edges.has(id)) return undefined
    path.push(id)
    onPath.add(id)
    for (const next of edges.get(id) ?? []) {
      const cycle = visit(next)
      if (cycle !== undefined) return cycle
    }
    path.pop()
    onPath.delete(id)
    finished.add(id)
    return undefined
  }

  for (const id of edges.keys()) {
    const cycle = visit(id)
    if (cycle !== undefined) return cycle
  }
  return undefined
}
```

- [ ] **Step 5: Write the validation helpers**

Create `src/spec/validation.ts`:

```ts
import { Effect, Schema } from "effect"
import { ValidationError } from "./errors.ts"
import { findCycle } from "./graph.ts"
import type { Task } from "./model.ts"

/** Decodes `value` with `schema`, failing with `ValidationError` instead of a schema error. */
export const validate = <S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  value: unknown,
): Effect.Effect<S["Type"], ValidationError> =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError((error) => new ValidationError({ issues: [error.message] })),
  )

/** Fails with `ValidationError` if the tasks' dependencies contain a self-dependency or a cycle (spec §1.6). */
export const ensureAcyclic = (tasks: Iterable<Task>): Effect.Effect<void, ValidationError> => {
  const cycle = findCycle(new Map(Array.from(tasks, (task) => [task.id, task.dependsOn])))
  return cycle === undefined
    ? Effect.void
    : Effect.fail(new ValidationError({ issues: [`dependency cycle: ${cycle.join(" → ")}`] }))
}

/** Removes repeated values, keeping the first occurrence of each. */
export const unique = <A>(values: ReadonlyArray<A>): ReadonlyArray<A> => [...new Set(values)]
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test test/spec/graph.test.ts test/spec/validation.test.ts`
Expected: `9 pass`, `0 fail`.

- [ ] **Step 7: Run the gate and commit**

```bash
bun run check
git add src/spec/errors.ts src/spec/graph.ts src/spec/validation.ts test/spec/graph.test.ts test/spec/validation.test.ts
git commit -m "Add todo.md errors, cycle detection and validation helpers" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014ak6bnNqeftYod6YDrWkcK"
```

---

### Task 3: The TodoStore contract and the effectTest helper

**Files:**
- Create: `src/spec/diagnostic.ts`, `src/spec/TodoStore.ts`, `src/spec/testing/effectTest.ts`
- Modify: `src/spec/testing.ts` (replace the `export {}` placeholder)
- Test: `test/spec/effectTest.test.ts`

**Interfaces:**
- Consumes: Task 1 model types and Task 2 errors.
- Produces:
  - `Severity` and `Diagnostic` `{ severity, code, message, taskId?, file?, line? }` (schemas and types).
  - `Capabilities` `{ groups, reorder, renameGroup, comments }` (schema and type) and `allCapabilities` (all `true`).
  - `class TodoStore`, a `Context.Service` with key `"@lemol/todo-md/spec/TodoStore"` and these members:
    - `capabilities`
    - `load()`, `get(id)`, `listDone()`
    - `add(input, placement?)`, `update(id, patch)`, `move(id, placement)`
    - `complete(id)`, `reopen(id)`, `remove(id)`
    - `renameGroup(from, to)`, `comment(id, input)`
    - `diagnostics()`

    The exact signatures are in the code below. Use `yield* TodoStore` to access it, and `TodoStore.of({...})` to build an implementation.
  - `effectTest(name, effect)` and `effectTest(name, effect, layer)`. Each registers a `bun:test` test that runs `effect` scoped, with `TestClock` (time starts at 0) and `TestConsole`.

- [ ] **Step 1: Write the failing test**

Create `test/spec/effectTest.test.ts`:

```ts
import { expect } from "bun:test"
import { Context, DateTime, Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { effectTest } from "../../src/spec/testing.ts"

class Greeting extends Context.Service<Greeting, { readonly text: string }>()("test/Greeting") {}

effectTest(
  "runs on the test clock, which starts at 0 and moves only when adjusted",
  Effect.gen(function* () {
    expect(DateTime.toEpochMillis(yield* DateTime.now)).toBe(0)
    yield* TestClock.adjust("1 minute")
    expect(DateTime.toEpochMillis(yield* DateTime.now)).toBe(60_000)
  }),
)

effectTest(
  "provides the given layer",
  Effect.gen(function* () {
    expect((yield* Greeting).text).toBe("hello")
  }),
  Layer.succeed(Greeting, Greeting.of({ text: "hello" })),
)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/spec/effectTest.test.ts`
Expected: FAIL with `SyntaxError: Export named 'effectTest' not found in module`. `src/spec/testing.ts` is still `export {}`.

- [ ] **Step 3: Write the diagnostic schema**

Create `src/spec/diagnostic.ts`:

```ts
import { Schema } from "effect"
import { TaskId } from "./model.ts"

export const Severity = Schema.Literals(["error", "warning", "info"])
export type Severity = typeof Severity.Type

/** A non-fatal issue found while reading a list (spec §1.6, §2.12). */
export const Diagnostic = Schema.Struct({
  severity: Severity,
  /** Stable kebab-case code from the spec, e.g. `broken-link`. */
  code: Schema.String,
  message: Schema.String,
  taskId: Schema.optional(TaskId),
  /** Path relative to the list root, when the issue has a location. */
  file: Schema.optional(Schema.String),
  /** 1-based line in `file`. */
  line: Schema.optional(Schema.Int),
})
export type Diagnostic = typeof Diagnostic.Type
```

- [ ] **Step 4: Write the contract**

Create `src/spec/TodoStore.ts`:

```ts
import { Context, type Effect, Schema } from "effect"
import type { Diagnostic } from "./diagnostic.ts"
import type {
  GroupNotFound,
  InvalidTransition,
  StoreError,
  TaskNotFound,
  Unsupported,
  ValidationError,
} from "./errors.ts"
import type {
  Comment,
  CommentInput,
  Placement,
  Task,
  TaskId,
  TaskInput,
  TaskPatch,
  TodoList,
} from "./model.ts"

/** Optional operations a store supports (spec §1.5). */
export const Capabilities = Schema.Struct({
  groups: Schema.Boolean,
  reorder: Schema.Boolean,
  renameGroup: Schema.Boolean,
  comments: Schema.Boolean,
})
export type Capabilities = typeof Capabilities.Type

export const allCapabilities: Capabilities = {
  groups: true,
  reorder: true,
  renameGroup: true,
  comments: true,
}

/**
 * The adapter contract: one method per operation in spec §1.4. Every
 * implementation must pass the conformance suite in `@lemol/todo-md/spec/testing`.
 */
export class TodoStore extends Context.Service<
  TodoStore,
  {
    readonly capabilities: Capabilities
    load(): Effect.Effect<TodoList, StoreError>
    get(id: TaskId): Effect.Effect<Task, TaskNotFound | StoreError>
    listDone(): Effect.Effect<ReadonlyArray<Task>, StoreError>
    add(
      input: TaskInput,
      placement?: Placement,
    ): Effect.Effect<Task, ValidationError | TaskNotFound | Unsupported | StoreError>
    update(
      id: TaskId,
      patch: TaskPatch,
    ): Effect.Effect<Task, TaskNotFound | ValidationError | StoreError>
    move(
      id: TaskId,
      placement: Placement,
    ): Effect.Effect<
      Task,
      TaskNotFound | InvalidTransition | ValidationError | Unsupported | StoreError
    >
    complete(id: TaskId): Effect.Effect<Task, TaskNotFound | InvalidTransition | StoreError>
    reopen(id: TaskId): Effect.Effect<Task, TaskNotFound | InvalidTransition | StoreError>
    remove(id: TaskId): Effect.Effect<void, TaskNotFound | StoreError>
    renameGroup(
      from: string,
      to: string,
    ): Effect.Effect<void, GroupNotFound | ValidationError | Unsupported | StoreError>
    comment(
      id: TaskId,
      input: CommentInput,
    ): Effect.Effect<Comment, TaskNotFound | ValidationError | Unsupported | StoreError>
    diagnostics(): Effect.Effect<ReadonlyArray<Diagnostic>, StoreError>
  }
>()("@lemol/todo-md/spec/TodoStore") {}
```

- [ ] **Step 5: Write the effectTest helper**

Create `src/spec/testing/effectTest.ts`:

```ts
import { test } from "bun:test"
import { Effect, Layer, type Scope } from "effect"
import { TestClock, TestConsole } from "effect/testing"

const TestEnv = Layer.mergeAll(TestConsole.layer, TestClock.layer())

/**
 * Registers a `bun:test` test that runs `effect` with a scope, Effect's
 * `TestClock` (time starts at 0 and only moves with `TestClock.adjust` or
 * `TestClock.setTime`) and `TestConsole`. Pass `layer` to provide services.
 */
export function effectTest<A, E>(name: string, effect: Effect.Effect<A, E, Scope.Scope>): void
export function effectTest<A, E, R, LE>(
  name: string,
  effect: Effect.Effect<A, E, R | Scope.Scope>,
  layer: Layer.Layer<R, LE>,
): void
export function effectTest<A, E, R, LE>(
  name: string,
  effect: Effect.Effect<A, E, R | Scope.Scope>,
  layer?: Layer.Layer<R, LE>,
): void {
  const provided = (layer === undefined ? effect : Effect.provide(effect, layer)) as Effect.Effect<
    A,
    E | LE,
    Scope.Scope
  >
  test(name, () => Effect.runPromise(provided.pipe(Effect.scoped, Effect.provide(TestEnv))))
}
```

Replace the contents of `src/spec/testing.ts` with:

```ts
export { effectTest } from "./testing/effectTest.ts"
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test test/spec/effectTest.test.ts`
Expected: `2 pass`, `0 fail`.

- [ ] **Step 7: Run the gate and commit**

```bash
bun run check
git add src/spec/diagnostic.ts src/spec/TodoStore.ts src/spec/testing/effectTest.ts src/spec/testing.ts test/spec/effectTest.test.ts
git commit -m "Add the TodoStore contract and the effectTest helper" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014ak6bnNqeftYod6YDrWkcK"
```

---

### Task 4: Conformance harness and MemoryTodoStore (reading and adding)

**Files:**
- Modify: `test/boundaries.test.ts` (let test helpers import `node:assert`)
- Create:
  - `src/spec/testing/conformance/case.ts`
  - `src/spec/testing/conformance/assert.ts`
  - `src/spec/testing/conformance/reading.ts`
  - `src/spec/testing/conformance/adding.ts`
  - `src/spec/testing/conformance/index.ts`
  - `src/spec/MemoryTodoStore.ts`
- Modify: `src/spec/testing.ts`
- Test: `test/spec/MemoryTodoStore.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces:
  - `interface ConformanceCase { name; requires?: ReadonlyArray<keyof Capabilities>; run: Effect<void, unknown, TodoStore> }`
  - `equal(actual, expected, message?)`, which throws on mismatch (`node:assert/strict` `deepStrictEqual`).
  - `failsWith(effect, tag): Effect<E, never, R>`, which asserts that the effect fails with that `_tag`.
  - `layout: Effect<Array<readonly [string, string[]]>, StoreError, TodoStore>`. It gives the open task IDs per section: first `["", ungroupedIds]`, then `[groupName, ids]` for each group.
  - `conformanceCases: ReadonlyArray<ConformanceCase>` and `runConformance(name: string, layer: Layer<TodoStore, E>): void`.
  - `src/spec/MemoryTodoStore.ts` exporting `interface Options { title?; description? }` and `layer(options?: Options): Layer<TodoStore>`.
    - Implemented in this task: `load`, `get`, `listDone`, `add`, `diagnostics`.
    - Every other operation dies with `MemoryTodoStore.<operation> is not implemented yet` until Tasks 5–7 replace it.

- [ ] **Step 1: Write a failing boundaries assertion for `node:assert`**

In `test/boundaries.test.ts`, inside the test `"keeps test helpers out of runtime code"`, add this directly after its first `expect(...)` line:

```ts
      expect(
        violations(at("spec", "testing", "assert.ts"), 'import { ok } from "node:assert/strict"'),
      ).toEqual([])
```

Run: `bun test test/boundaries.test.ts`
Expected: FAIL. The violation message is `module spec must not import package node:assert/strict`.

- [ ] **Step 2: Allow `node:assert` in test helpers**

In `test/boundaries.test.ts`, replace:

```ts
// Test helpers shipped for adapters (`@lemol/todo-md/spec/testing`) may use
// the test runner; nothing else may import them.
const testingEntry = join("spec", "testing")
```

with:

```ts
// Test helpers shipped for adapters (`@lemol/todo-md/spec/testing`) may use
// the test runner and assertions; nothing else may import them.
const testingEntry = join("spec", "testing")
const testingPackages = ["bun:test", "node:assert"]
```

and replace:

```ts
    if (specifier === "bun:test" && isTestingFile(file)) return []
```

with:

```ts
    if (isTestingFile(file) && testingPackages.some((entry) => allows(entry, specifier))) return []
```

Run: `bun test test/boundaries.test.ts`
Expected: `5 pass`, `0 fail`.

- [ ] **Step 3: Write the conformance harness**

Create `src/spec/testing/conformance/case.ts`:

```ts
import type { Effect } from "effect"
import type { Capabilities, TodoStore } from "../../TodoStore.ts"

/**
 * One executable statement of the spec's operation semantics. `run` gets a
 * fresh, empty store and fails (usually as a defect from `equal`) when the
 * store misbehaves. Cases whose `requires` capabilities the store lacks are
 * skipped.
 */
export interface ConformanceCase {
  readonly name: string
  readonly requires?: ReadonlyArray<keyof Capabilities>
  readonly run: Effect.Effect<void, unknown, TodoStore>
}
```

Create `src/spec/testing/conformance/assert.ts`:

```ts
import { deepStrictEqual } from "node:assert/strict"
import { Effect } from "effect"
import type { Task } from "../../model.ts"
import { TodoStore } from "../../TodoStore.ts"

/** Asserts deep equality; a mismatch fails the case as a defect. */
export const equal = <A>(actual: A, expected: A, message?: string): void =>
  deepStrictEqual(actual, expected, message)

/** Runs `effect`, asserting it fails with an error whose `_tag` is `tag`. */
export const failsWith = <A, E extends { readonly _tag: string }, R>(
  effect: Effect.Effect<A, E, R>,
  tag: E["_tag"],
): Effect.Effect<E, never, R> =>
  Effect.flip(effect).pipe(
    Effect.tap((error) => Effect.sync(() => equal(error._tag, tag, `expected ${tag}`))),
    Effect.orDie,
  )

const section = (name: string, tasks: ReadonlyArray<Task>) =>
  [name, tasks.map((task) => task.id)] as const

/** The open tasks' IDs per section: the ungrouped section (named "") first, then each group. */
export const layout = Effect.gen(function* () {
  const list = yield* (yield* TodoStore).load()
  return [
    section("", list.ungrouped),
    ...list.groups.map((group) => section(group.name, group.tasks)),
  ]
})
```

- [ ] **Step 4: Write the reading and adding cases**

Create `src/spec/testing/conformance/reading.ts`. Task 6 adds a third case to this file.

```ts
import { Effect } from "effect"
import { TodoStore } from "../../TodoStore.ts"
import { equal } from "./assert.ts"
import type { ConformanceCase } from "./case.ts"

export const readingCases: ReadonlyArray<ConformanceCase> = [
  {
    name: "load returns a list without tasks for a new store",
    run: Effect.gen(function* () {
      const list = yield* (yield* TodoStore).load()
      equal(list.ungrouped, [])
      equal(list.groups, [])
    }),
  },
  {
    name: "listDone is empty for a new store",
    run: Effect.gen(function* () {
      equal(yield* (yield* TodoStore).listDone(), [])
    }),
  },
]
```

Create `src/spec/testing/conformance/adding.ts`:

```ts
import { Effect } from "effect"
import { TodoStore } from "../../TodoStore.ts"
import { equal, failsWith, layout } from "./assert.ts"
import type { ConformanceCase } from "./case.ts"

export const addingCases: ReadonlyArray<ConformanceCase> = [
  {
    name: "add creates an open, ungrouped task with defaults",
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const task = yield* store.add({ title: "Write changelog" })
      equal(task.title, "Write changelog")
      equal(task.status, "open")
      equal(task.description, "")
      equal(task.tags, [])
      equal(task.assignee, undefined)
      equal(task.dependsOn, [])
      equal(task.comments, [])
      equal(task.group, undefined)
      equal(task.completedAt, undefined)
      equal(task.extra, {})
      equal((yield* store.get(task.id)).title, "Write changelog")
      equal(yield* layout, [["", [task.id]]])
    }),
  },
  {
    name: "add keeps every field of the input",
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const first = yield* store.add({ title: "Fix login redirect" })
      const task = yield* store.add({
        title: "Add rate limiting",
        description: "Token bucket per API key.",
        tags: ["api", "security"],
        assignee: "lemol",
        dependsOn: [first.id],
        extra: { estimate: 3 },
      })
      const stored = yield* store.get(task.id)
      equal(stored.description, "Token bucket per API key.")
      equal(stored.tags, ["api", "security"])
      equal(stored.assignee, "lemol")
      equal(stored.dependsOn, [first.id])
      equal(stored.extra, { estimate: 3 })
    }),
  },
  {
    name: "add assigns a unique ID to every task and appends in order",
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const a = yield* store.add({ title: "A" })
      const b = yield* store.add({ title: "B" })
      const c = yield* store.add({ title: "C" })
      equal(new Set([a.id, b.id, c.id]).size, 3)
      equal(yield* layout, [["", [a.id, b.id, c.id]]])
    }),
  },
  {
    name: "add removes duplicate tags, keeping the first occurrence",
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const task = yield* store.add({ title: "Tagged", tags: ["api", "security", "api"] })
      equal((yield* store.get(task.id)).tags, ["api", "security"])
    }),
  },
  {
    name: "add rejects invalid input and changes nothing",
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      yield* failsWith(store.add({ title: "" }), "ValidationError")
      yield* failsWith(store.add({ title: "two\nlines" }), "ValidationError")
      yield* failsWith(store.add({ title: "Tagged", tags: [""] }), "ValidationError")
      equal(yield* layout, [["", []]])
    }),
  },
  {
    name: "add to a group appends to it, creating the group at the end of the list",
    requires: ["groups"],
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const a = yield* store.add({ title: "A" }, { group: "Backend" })
      const b = yield* store.add({ title: "B" }, { group: "Frontend" })
      const c = yield* store.add({ title: "C" }, { group: "Backend" })
      equal(c.group, "Backend")
      equal(yield* layout, [
        ["", []],
        ["Backend", [a.id, c.id]],
        ["Frontend", [b.id]],
      ])
    }),
  },
  {
    name: "add places a task before or after an anchor",
    requires: ["reorder"],
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const a = yield* store.add({ title: "A" })
      const c = yield* store.add({ title: "C" })
      const b = yield* store.add({ title: "B" }, { after: a.id })
      const z = yield* store.add({ title: "Z" }, { before: a.id })
      equal(yield* layout, [["", [z.id, a.id, b.id, c.id]]])
    }),
  },
  {
    name: "add takes the anchor's group and rejects a conflicting group",
    requires: ["groups", "reorder"],
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const a = yield* store.add({ title: "A" }, { group: "Backend" })
      const b = yield* store.add({ title: "B" }, { before: a.id })
      equal(b.group, "Backend")
      yield* failsWith(
        store.add({ title: "C" }, { group: "Frontend", before: a.id }),
        "ValidationError",
      )
      equal(yield* layout, [
        ["", []],
        ["Backend", [b.id, a.id]],
      ])
    }),
  },
  {
    name: "add rejects an unknown anchor or two anchors and changes nothing",
    requires: ["reorder"],
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const a = yield* store.add({ title: "A" })
      yield* failsWith(store.add({ title: "B" }, { after: "does-not-exist" }), "TaskNotFound")
      yield* failsWith(store.add({ title: "B" }, { before: a.id, after: a.id }), "ValidationError")
      equal(yield* layout, [["", [a.id]]])
    }),
  },
]
```

Create `src/spec/testing/conformance/index.ts`:

```ts
import { describe } from "bun:test"
import { Effect, type Layer } from "effect"
import { TodoStore } from "../../TodoStore.ts"
import { effectTest } from "../effectTest.ts"
import { addingCases } from "./adding.ts"
import type { ConformanceCase } from "./case.ts"
import { readingCases } from "./reading.ts"

/** Every conformance case, as runner-agnostic Effects. */
export const conformanceCases: ReadonlyArray<ConformanceCase> = [...readingCases, ...addingCases]

/**
 * Registers every conformance case with `bun:test`. `layer` must build a fresh,
 * empty store each time it is provided; each case gets its own.
 */
export const runConformance = <E>(name: string, layer: Layer.Layer<TodoStore, E>): void =>
  describe(`${name} conforms to TodoStore`, () => {
    for (const testCase of conformanceCases) {
      effectTest(
        testCase.name,
        Effect.gen(function* () {
          const { capabilities } = yield* TodoStore
          if (testCase.requires?.some((capability) => !capabilities[capability])) return
          yield* testCase.run
        }),
        layer,
      )
    }
  })
```

Replace the contents of `src/spec/testing.ts` with:

```ts
export { equal, failsWith, layout } from "./testing/conformance/assert.ts"
export type { ConformanceCase } from "./testing/conformance/case.ts"
export { conformanceCases, runConformance } from "./testing/conformance/index.ts"
export { effectTest } from "./testing/effectTest.ts"
```

- [ ] **Step 5: Write the failing store test**

Create `test/spec/MemoryTodoStore.test.ts`:

```ts
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import * as MemoryTodoStore from "../../src/spec/MemoryTodoStore.ts"
import { allCapabilities, TodoStore } from "../../src/spec/TodoStore.ts"
import { effectTest, runConformance } from "../../src/spec/testing.ts"

runConformance("MemoryTodoStore", MemoryTodoStore.layer())

describe("MemoryTodoStore", () => {
  effectTest(
    "starts with the given title and description",
    Effect.gen(function* () {
      const list = yield* (yield* TodoStore).load()
      expect(list.title).toBe("Acme API")
      expect(list.description).toBe("Backlog for the Acme public API.")
    }),
    MemoryTodoStore.layer({ title: "Acme API", description: "Backlog for the Acme public API." }),
  )

  effectTest(
    "supports every capability and reports no diagnostics",
    Effect.gen(function* () {
      const store = yield* TodoStore
      expect(store.capabilities).toEqual(allCapabilities)
      expect(yield* store.diagnostics()).toEqual([])
    }),
    MemoryTodoStore.layer(),
  )
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `bun test test/spec/MemoryTodoStore.test.ts`
Expected: FAIL with `Cannot find module '../../src/spec/MemoryTodoStore.ts'`.

- [ ] **Step 7: Write the store**

Create `src/spec/MemoryTodoStore.ts`:

```ts
/**
 * The reference `TodoStore`: the whole list lives in memory. It is the
 * simplest executable statement of the operation semantics in spec §1.4.
 */

import { Effect, Layer, SynchronizedRef } from "effect"
import { TaskNotFound, ValidationError } from "./errors.ts"
import { Placement, type Task, type TaskId, TaskInput, type TodoList } from "./model.ts"
import { allCapabilities, TodoStore } from "./TodoStore.ts"
import { ensureAcyclic, unique, validate } from "./validation.ts"

interface Section {
  /** `undefined` for the ungrouped section, which is always first. */
  readonly name: string | undefined
  readonly description: string
  readonly tasks: ReadonlyArray<Task>
}

interface State {
  readonly title: string
  readonly description: string
  readonly sections: ReadonlyArray<Section>
  /** Done tasks, most recently completed first. */
  readonly done: ReadonlyArray<Task>
  readonly lastId: number
}

interface Located {
  readonly sectionIndex: number
  readonly taskIndex: number
  readonly task: Task
}

const locateOpen = (state: State, id: TaskId): Located | undefined => {
  for (const [sectionIndex, section] of state.sections.entries()) {
    const taskIndex = section.tasks.findIndex((task) => task.id === id)
    const task = section.tasks[taskIndex]
    if (task !== undefined) return { sectionIndex, taskIndex, task }
  }
  return undefined
}

const findTask = (state: State, id: TaskId): Effect.Effect<Task, TaskNotFound> => {
  const task = locateOpen(state, id)?.task ?? state.done.find((done) => done.id === id)
  return task === undefined ? Effect.fail(new TaskNotFound({ id })) : Effect.succeed(task)
}

const allTasks = (state: State): ReadonlyArray<Task> => [
  ...state.sections.flatMap((section) => section.tasks),
  ...state.done,
]

/** The index just past the last task of `group`, or 0 if the group does not exist. */
const endOf = (state: State, group: string | undefined): number =>
  state.sections.find((section) => section.name === group)?.tasks.length ?? 0

/** Inserts `task` into `group` (created at the end of the list if missing) at `index`. */
const insert = (state: State, group: string | undefined, index: number, task: Task): State => {
  const sections = state.sections.some((section) => section.name === group)
    ? state.sections
    : [...state.sections, { name: group, description: "", tasks: [] }]
  return {
    ...state,
    sections: sections.map((section) =>
      section.name === group
        ? {
            ...section,
            tasks: [
              ...section.tasks.slice(0, index),
              { ...task, group },
              ...section.tasks.slice(index),
            ],
          }
        : section,
    ),
  }
}

/** Resolves a placement against `state`, which must not contain the task being placed. */
const resolve = (
  state: State,
  placement: Placement,
): Effect.Effect<
  { readonly group: string | undefined; readonly index: number },
  TaskNotFound | ValidationError
> => {
  if (placement.before !== undefined && placement.after !== undefined) {
    return Effect.fail(
      new ValidationError({ issues: ["a placement takes before or after, not both"] }),
    )
  }
  const anchorId = placement.before ?? placement.after
  if (anchorId === undefined) {
    return Effect.succeed({ group: placement.group, index: endOf(state, placement.group) })
  }
  const anchor = locateOpen(state, anchorId)
  if (anchor === undefined) return Effect.fail(new TaskNotFound({ id: anchorId }))
  const group = state.sections[anchor.sectionIndex]?.name
  if (placement.group !== undefined && placement.group !== group) {
    return Effect.fail(
      new ValidationError({ issues: [`task ${anchorId} is not in group ${placement.group}`] }),
    )
  }
  const index = placement.before !== undefined ? anchor.taskIndex : anchor.taskIndex + 1
  return Effect.succeed({ group, index })
}

/** Stands in for an operation a later step implements. */
const notYet = (operation: string) => () =>
  Effect.die(new Error(`MemoryTodoStore.${operation} is not implemented yet`))

export interface Options {
  readonly title?: string
  readonly description?: string
}

/** Builds a fresh, empty in-memory store each time the layer is provided. */
export const layer = (options: Options = {}): Layer.Layer<TodoStore> =>
  Layer.effect(
    TodoStore,
    Effect.gen(function* () {
      const ref = yield* SynchronizedRef.make<State>({
        title: options.title ?? "",
        description: options.description ?? "",
        sections: [{ name: undefined, description: "", tasks: [] }],
        done: [],
        lastId: 0,
      })

      const read = SynchronizedRef.get(ref)

      // The new state is kept only if `f` succeeds, so failed operations change nothing.
      const transact = <A, E>(f: (state: State) => Effect.Effect<readonly [A, State], E>) =>
        SynchronizedRef.modifyEffect(ref, f)

      return TodoStore.of({
        capabilities: allCapabilities,

        load: () =>
          Effect.map(read, (state): TodoList => {
            const [ungrouped, ...groups] = state.sections
            return {
              title: state.title,
              description: state.description,
              ungrouped: ungrouped?.tasks ?? [],
              groups: groups.map((section) => ({
                name: section.name ?? "",
                description: section.description,
                tasks: section.tasks,
              })),
            }
          }),

        get: (id) => Effect.flatMap(read, (state) => findTask(state, id)),

        listDone: () => Effect.map(read, (state) => state.done),

        add: (input, placement = {}) =>
          transact((state) =>
            Effect.gen(function* () {
              const valid = yield* validate(TaskInput, input)
              const where = yield* validate(Placement, placement)
              const target = yield* resolve(state, where)
              const task: Task = {
                id: String(state.lastId + 1),
                title: valid.title,
                description: valid.description ?? "",
                status: "open",
                tags: unique(valid.tags ?? []),
                assignee: valid.assignee,
                dependsOn: unique(valid.dependsOn ?? []),
                comments: [],
                group: target.group,
                extra: valid.extra ?? {},
              }
              const next = insert(
                { ...state, lastId: state.lastId + 1 },
                target.group,
                target.index,
                task,
              )
              yield* ensureAcyclic(allTasks(next))
              return [task, next] as const
            }),
          ),

        update: notYet("update"),
        move: notYet("move"),
        complete: notYet("complete"),
        reopen: notYet("reopen"),
        remove: notYet("remove"),
        renameGroup: notYet("renameGroup"),
        comment: notYet("comment"),

        diagnostics: () => Effect.succeed([]),
      })
    }),
  )
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `bun test test/spec/MemoryTodoStore.test.ts`
Expected: `13 pass`, `0 fail`.

- [ ] **Step 9: Run the gate and commit**

```bash
bun run check
git add test/boundaries.test.ts src/spec/testing src/spec/testing.ts src/spec/MemoryTodoStore.ts test/spec/MemoryTodoStore.test.ts
git commit -m "Add the conformance harness and an in-memory TodoStore" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014ak6bnNqeftYod6YDrWkcK"
```

---

### Task 5: complete, reopen and remove

**Files:**
- Create: `src/spec/testing/conformance/lifecycle.ts`
- Modify: `src/spec/testing/conformance/index.ts`, `src/spec/MemoryTodoStore.ts`
- Test: `test/spec/MemoryTodoStore.test.ts` (runs the new cases through `runConformance`)

**Interfaces:**
- Consumes: `TodoStore`, `ConformanceCase`, `equal`, `failsWith` and `layout` from Tasks 3–4, and `TestClock` from `effect/testing`.
- Produces:
  - **Store behavior:**
    - `complete` sets `status: "done"` and `completedAt = DateTime.now`, and moves the task to the front of `listDone`.
    - `reopen` appends the task to the end of its recorded group, or of the ungrouped tasks if that group is gone.
    - `remove` deletes an open or a done task.
  - **Private helpers** in `MemoryTodoStore.ts`:
    - `findOpen(state, id, operation): Effect<Located, TaskNotFound | InvalidTransition>`
    - `withoutTask(state, id): State`

- [ ] **Step 1: Write the lifecycle cases**

Create `src/spec/testing/conformance/lifecycle.ts`:

```ts
import { DateTime, Effect } from "effect"
import { TestClock } from "effect/testing"
import { TodoStore } from "../../TodoStore.ts"
import { equal, failsWith, layout } from "./assert.ts"
import type { ConformanceCase } from "./case.ts"

const at = Date.parse("2026-09-12T10:31:00Z")
const millis = (date: DateTime.Utc | undefined) =>
  date === undefined ? undefined : DateTime.toEpochMillis(date)

export const lifecycleCases: ReadonlyArray<ConformanceCase> = [
  {
    name: "complete marks the task done at the current time and takes it out of the list",
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      yield* TestClock.setTime(at)
      const task = yield* store.add({ title: "Ship it" })
      const done = yield* store.complete(task.id)
      equal(done.status, "done")
      equal(millis(done.completedAt), at)
      const stored = yield* store.get(task.id)
      equal(stored.status, "done")
      equal(millis(stored.completedAt), at)
      equal(yield* layout, [["", []]])
      equal(
        (yield* store.listDone()).map((t) => t.id),
        [task.id],
      )
    }),
  },
  {
    name: "complete records the group the task was in",
    requires: ["groups"],
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const task = yield* store.add({ title: "Ship it" }, { group: "Backend" })
      yield* store.complete(task.id)
      equal((yield* store.get(task.id)).group, "Backend")
    }),
  },
  {
    name: "complete allows a blocked task and rejects a done one",
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const a = yield* store.add({ title: "A" })
      const b = yield* store.add({ title: "B", dependsOn: [a.id] })
      yield* store.complete(b.id)
      yield* failsWith(store.complete(b.id), "InvalidTransition")
    }),
  },
  {
    name: "listDone returns the most recently completed task first",
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const a = yield* store.add({ title: "A" })
      const b = yield* store.add({ title: "B" })
      const c = yield* store.add({ title: "C" })
      yield* store.complete(a.id)
      yield* TestClock.adjust("1 minute")
      yield* store.complete(c.id)
      yield* TestClock.adjust("1 minute")
      yield* store.complete(b.id)
      equal(
        (yield* store.listDone()).map((t) => t.id),
        [b.id, c.id, a.id],
      )
    }),
  },
  {
    name: "reopen puts the task back at the end of its section",
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const a = yield* store.add({ title: "A" })
      const b = yield* store.add({ title: "B" })
      yield* store.complete(a.id)
      const reopened = yield* store.reopen(a.id)
      equal(reopened.status, "open")
      equal(reopened.completedAt, undefined)
      equal(yield* layout, [["", [b.id, a.id]]])
      equal(yield* store.listDone(), [])
      yield* failsWith(store.reopen(a.id), "InvalidTransition")
    }),
  },
  {
    name: "reopen puts the task back at the end of its recorded group",
    requires: ["groups"],
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const a = yield* store.add({ title: "A" }, { group: "Backend" })
      const b = yield* store.add({ title: "B" }, { group: "Backend" })
      yield* store.complete(a.id)
      equal((yield* store.reopen(a.id)).group, "Backend")
      equal(yield* layout, [
        ["", []],
        ["Backend", [b.id, a.id]],
      ])
    }),
  },
  {
    name: "remove deletes open and done tasks",
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const a = yield* store.add({ title: "A" })
      const b = yield* store.add({ title: "B" })
      yield* store.complete(b.id)
      yield* store.remove(a.id)
      yield* store.remove(b.id)
      yield* failsWith(store.get(a.id), "TaskNotFound")
      yield* failsWith(store.get(b.id), "TaskNotFound")
      equal(yield* layout, [["", []]])
      equal(yield* store.listDone(), [])
    }),
  },
]
```

Replace `src/spec/testing/conformance/index.ts` with:

```ts
import { describe } from "bun:test"
import { Effect, type Layer } from "effect"
import { TodoStore } from "../../TodoStore.ts"
import { effectTest } from "../effectTest.ts"
import { addingCases } from "./adding.ts"
import type { ConformanceCase } from "./case.ts"
import { lifecycleCases } from "./lifecycle.ts"
import { readingCases } from "./reading.ts"

/** Every conformance case, as runner-agnostic Effects. */
export const conformanceCases: ReadonlyArray<ConformanceCase> = [
  ...readingCases,
  ...addingCases,
  ...lifecycleCases,
]

/**
 * Registers every conformance case with `bun:test`. `layer` must build a fresh,
 * empty store each time it is provided; each case gets its own.
 */
export const runConformance = <E>(name: string, layer: Layer.Layer<TodoStore, E>): void =>
  describe(`${name} conforms to TodoStore`, () => {
    for (const testCase of conformanceCases) {
      effectTest(
        testCase.name,
        Effect.gen(function* () {
          const { capabilities } = yield* TodoStore
          if (testCase.requires?.some((capability) => !capabilities[capability])) return
          yield* testCase.run
        }),
        layer,
      )
    }
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/spec/MemoryTodoStore.test.ts`
Expected: `13 pass`, `7 fail`. The failures die with `MemoryTodoStore.complete is not implemented yet`.

- [ ] **Step 3: Implement the operations**

In `src/spec/MemoryTodoStore.ts`, make these five edits:

1. Replace the three `import` lines from `"effect"`, `"./errors.ts"` and `"./model.ts"` with:

```ts
import { DateTime, Effect, Layer, SynchronizedRef } from "effect"
import { InvalidTransition, TaskNotFound, ValidationError } from "./errors.ts"
import { Placement, type Task, type TaskId, TaskInput, type TodoList } from "./model.ts"
```

2. Add after the `findTask` function:

```ts
const findOpen = (
  state: State,
  id: TaskId,
  operation: string,
): Effect.Effect<Located, TaskNotFound | InvalidTransition> => {
  const located = locateOpen(state, id)
  if (located !== undefined) return Effect.succeed(located)
  return Effect.fail(
    state.done.some((task) => task.id === id)
      ? new InvalidTransition({ id, status: "done", operation })
      : new TaskNotFound({ id }),
  )
}
```

3. Add after the `allTasks` function:

```ts
const withoutTask = (state: State, id: TaskId): State => ({
  ...state,
  sections: state.sections.map((section) => ({
    ...section,
    tasks: section.tasks.filter((task) => task.id !== id),
  })),
  done: state.done.filter((task) => task.id !== id),
})
```

4. Replace `complete: notYet("complete"),`, `reopen: notYet("reopen"),` and `remove: notYet("remove"),` with:

```ts
        complete: (id) =>
          transact((state) =>
            Effect.gen(function* () {
              const { task } = yield* findOpen(state, id, "complete")
              const done: Task = { ...task, status: "done", completedAt: yield* DateTime.now }
              const rest = withoutTask(state, id)
              return [done, { ...rest, done: [done, ...rest.done] }] as const
            }),
          ),

        reopen: (id) =>
          transact((state) =>
            Effect.gen(function* () {
              const task = state.done.find((done) => done.id === id)
              if (task === undefined) {
                return yield* Effect.fail(
                  locateOpen(state, id) === undefined
                    ? new TaskNotFound({ id })
                    : new InvalidTransition({ id, status: "open", operation: "reopen" }),
                )
              }
              const group = state.sections.some(
                (section) => section.name !== undefined && section.name === task.group,
              )
                ? task.group
                : undefined
              const reopened: Task = { ...task, status: "open", completedAt: undefined, group }
              const rest = withoutTask(state, id)
              return [reopened, insert(rest, group, endOf(rest, group), reopened)] as const
            }),
          ),

        remove: (id) =>
          transact((state) =>
            Effect.gen(function* () {
              yield* findTask(state, id)
              return [undefined, withoutTask(state, id)] as const
            }),
          ),
```

5. Run `bun run fix` to normalize formatting.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test test/spec/MemoryTodoStore.test.ts`
Expected: `20 pass`, `0 fail`.

- [ ] **Step 5: Run the gate and commit**

```bash
bun run check
git add src/spec/testing/conformance src/spec/MemoryTodoStore.ts
git commit -m "Complete, reopen and remove tasks in the in-memory store" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014ak6bnNqeftYod6YDrWkcK"
```

---

### Task 6: update and move

**Files:**
- Create: `src/spec/testing/conformance/updating.ts`, `src/spec/testing/conformance/moving.ts`
- Modify:
  - `src/spec/testing/conformance/reading.ts` (unknown-ID case)
  - `src/spec/testing/conformance/index.ts`
  - `src/spec/MemoryTodoStore.ts`
- Test: `test/spec/MemoryTodoStore.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces:
  - **`update`** applies a `TaskPatch` to an open or done task:
    - absent fields are unchanged;
    - `assignee: null` clears the assignee;
    - duplicate tags are removed;
    - self-dependencies and cycles are rejected with `ValidationError`.
  - **`move`** takes a `Placement`:
    - it reorders a task or moves it to another group;
    - it fails with `InvalidTransition` for done tasks and `ValidationError` for self-anchors.
  - **Private helper** in `MemoryTodoStore.ts`: `replaceTask(state, task): State`.

- [ ] **Step 1: Write the update, move and unknown-ID cases**

Create `src/spec/testing/conformance/updating.ts`:

```ts
import { Effect } from "effect"
import { TodoStore } from "../../TodoStore.ts"
import { equal, failsWith } from "./assert.ts"
import type { ConformanceCase } from "./case.ts"

export const updatingCases: ReadonlyArray<ConformanceCase> = [
  {
    name: "update changes the given fields and keeps the rest",
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const dependency = yield* store.add({ title: "Dependency" })
      const task = yield* store.add({
        title: "Old title",
        tags: ["api"],
        assignee: "lemol",
        extra: { estimate: 3 },
      })
      const updated = yield* store.update(task.id, {
        title: "New title",
        description: "Details.",
        dependsOn: [dependency.id],
      })
      equal(updated.title, "New title")
      const stored = yield* store.get(task.id)
      equal(stored.title, "New title")
      equal(stored.description, "Details.")
      equal(stored.dependsOn, [dependency.id])
      equal(stored.tags, ["api"])
      equal(stored.assignee, "lemol")
      equal(stored.extra, { estimate: 3 })
    }),
  },
  {
    name: "update clears the assignee with null and replaces tags without duplicates",
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const task = yield* store.add({ title: "Task", tags: ["a"], assignee: "lemol" })
      yield* store.update(task.id, { assignee: null, tags: ["x", "y", "x"] })
      const stored = yield* store.get(task.id)
      equal(stored.assignee, undefined)
      equal(stored.tags, ["x", "y"])
    }),
  },
  {
    name: "update works on a done task",
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const task = yield* store.add({ title: "Old title" })
      yield* store.complete(task.id)
      yield* store.update(task.id, { title: "New title" })
      const stored = yield* store.get(task.id)
      equal(stored.title, "New title")
      equal(stored.status, "done")
    }),
  },
  {
    name: "update allows a dependency on a task that no longer exists",
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const gone = yield* store.add({ title: "Gone" })
      yield* store.remove(gone.id)
      const task = yield* store.add({ title: "Task" })
      yield* store.update(task.id, { dependsOn: [gone.id] })
      equal((yield* store.get(task.id)).dependsOn, [gone.id])
    }),
  },
  {
    name: "update rejects invalid input, self-dependencies and cycles, changing nothing",
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const a = yield* store.add({ title: "A" })
      const b = yield* store.add({ title: "B", dependsOn: [a.id] })
      yield* failsWith(store.update(a.id, { title: "" }), "ValidationError")
      yield* failsWith(store.update(a.id, { dependsOn: [a.id] }), "ValidationError")
      yield* failsWith(store.update(a.id, { dependsOn: [b.id] }), "ValidationError")
      const stored = yield* store.get(a.id)
      equal(stored.title, "A")
      equal(stored.dependsOn, [])
    }),
  },
]
```

Create `src/spec/testing/conformance/moving.ts`:

```ts
import { Effect } from "effect"
import { TodoStore } from "../../TodoStore.ts"
import { equal, failsWith, layout } from "./assert.ts"
import type { ConformanceCase } from "./case.ts"

export const movingCases: ReadonlyArray<ConformanceCase> = [
  {
    name: "move reorders a task within its section",
    requires: ["reorder"],
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const a = yield* store.add({ title: "A" })
      const b = yield* store.add({ title: "B" })
      const c = yield* store.add({ title: "C" })
      yield* store.move(c.id, { before: a.id })
      equal(yield* layout, [["", [c.id, a.id, b.id]]])
      yield* store.move(c.id, { after: b.id })
      equal(yield* layout, [["", [a.id, b.id, c.id]]])
    }),
  },
  {
    name: "move to another group appends the task there and updates its group",
    requires: ["groups", "reorder"],
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const a = yield* store.add({ title: "A" }, { group: "Backend" })
      const b = yield* store.add({ title: "B" }, { group: "Frontend" })
      const moved = yield* store.move(a.id, { group: "Frontend" })
      equal(moved.group, "Frontend")
      equal((yield* store.get(a.id)).group, "Frontend")
      equal(yield* layout, [
        ["", []],
        ["Backend", []],
        ["Frontend", [b.id, a.id]],
      ])
    }),
  },
  {
    name: "move without group or anchor appends to the ungrouped tasks",
    requires: ["groups", "reorder"],
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const a = yield* store.add({ title: "A" }, { group: "Backend" })
      const u = yield* store.add({ title: "U" })
      yield* store.move(a.id, {})
      equal((yield* store.get(a.id)).group, undefined)
      equal(yield* layout, [
        ["", [u.id, a.id]],
        ["Backend", []],
      ])
    }),
  },
  {
    name: "move to a new group creates it at the end of the list",
    requires: ["groups", "reorder"],
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const a = yield* store.add({ title: "A" }, { group: "Backend" })
      yield* store.move(a.id, { group: "Later" })
      equal(yield* layout, [
        ["", []],
        ["Backend", []],
        ["Later", [a.id]],
      ])
    }),
  },
  {
    name: "move rejects done tasks, unknown IDs and self-anchors, changing nothing",
    requires: ["reorder"],
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const a = yield* store.add({ title: "A" })
      const done = yield* store.add({ title: "Done" })
      yield* store.complete(done.id)
      yield* failsWith(store.move(done.id, {}), "InvalidTransition")
      yield* failsWith(store.move("does-not-exist", {}), "TaskNotFound")
      yield* failsWith(store.move(a.id, { before: "does-not-exist" }), "TaskNotFound")
      yield* failsWith(store.move(a.id, { before: a.id }), "ValidationError")
      equal(yield* layout, [["", [a.id]]])
    }),
  },
]
```

Replace `src/spec/testing/conformance/reading.ts` with (adds the unknown-ID case):

```ts
import { Effect } from "effect"
import { TodoStore } from "../../TodoStore.ts"
import { equal, failsWith } from "./assert.ts"
import type { ConformanceCase } from "./case.ts"

export const readingCases: ReadonlyArray<ConformanceCase> = [
  {
    name: "load returns a list without tasks for a new store",
    run: Effect.gen(function* () {
      const list = yield* (yield* TodoStore).load()
      equal(list.ungrouped, [])
      equal(list.groups, [])
    }),
  },
  {
    name: "listDone is empty for a new store",
    run: Effect.gen(function* () {
      equal(yield* (yield* TodoStore).listDone(), [])
    }),
  },
  {
    name: "operations on an unknown ID fail with TaskNotFound",
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const id = "does-not-exist"
      yield* failsWith(store.get(id), "TaskNotFound")
      yield* failsWith(store.update(id, { title: "New" }), "TaskNotFound")
      yield* failsWith(store.complete(id), "TaskNotFound")
      yield* failsWith(store.reopen(id), "TaskNotFound")
      yield* failsWith(store.remove(id), "TaskNotFound")
    }),
  },
]
```

Replace `src/spec/testing/conformance/index.ts` with:

```ts
import { describe } from "bun:test"
import { Effect, type Layer } from "effect"
import { TodoStore } from "../../TodoStore.ts"
import { effectTest } from "../effectTest.ts"
import { addingCases } from "./adding.ts"
import type { ConformanceCase } from "./case.ts"
import { lifecycleCases } from "./lifecycle.ts"
import { movingCases } from "./moving.ts"
import { readingCases } from "./reading.ts"
import { updatingCases } from "./updating.ts"

/** Every conformance case, as runner-agnostic Effects. */
export const conformanceCases: ReadonlyArray<ConformanceCase> = [
  ...readingCases,
  ...addingCases,
  ...updatingCases,
  ...movingCases,
  ...lifecycleCases,
]

/**
 * Registers every conformance case with `bun:test`. `layer` must build a fresh,
 * empty store each time it is provided; each case gets its own.
 */
export const runConformance = <E>(name: string, layer: Layer.Layer<TodoStore, E>): void =>
  describe(`${name} conforms to TodoStore`, () => {
    for (const testCase of conformanceCases) {
      effectTest(
        testCase.name,
        Effect.gen(function* () {
          const { capabilities } = yield* TodoStore
          if (testCase.requires?.some((capability) => !capabilities[capability])) return
          yield* testCase.run
        }),
        layer,
      )
    }
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/spec/MemoryTodoStore.test.ts`
Expected: `20 pass`, `11 fail`. The failures die with `MemoryTodoStore.update is not implemented yet` or `MemoryTodoStore.move is not implemented yet`.

- [ ] **Step 3: Implement the operations**

In `src/spec/MemoryTodoStore.ts`, make these four edits:

1. Replace the three `import` lines from `"effect"`, `"./errors.ts"` and `"./model.ts"` with:

```ts
import { DateTime, Effect, Layer, SynchronizedRef } from "effect"
import { InvalidTransition, TaskNotFound, ValidationError } from "./errors.ts"
import { Placement, type Task, type TaskId, TaskInput, TaskPatch, type TodoList } from "./model.ts"
```

2. Add after the `withoutTask` function:

```ts
const replaceTask = (state: State, updated: Task): State => ({
  ...state,
  sections: state.sections.map((section) => ({
    ...section,
    tasks: section.tasks.map((task) => (task.id === updated.id ? updated : task)),
  })),
  done: state.done.map((task) => (task.id === updated.id ? updated : task)),
})
```

3. Replace `update: notYet("update"),` and `move: notYet("move"),` with:

```ts
        update: (id, patch) =>
          transact((state) =>
            Effect.gen(function* () {
              const valid = yield* validate(TaskPatch, patch)
              const task = yield* findTask(state, id)
              const updated: Task = {
                ...task,
                title: valid.title ?? task.title,
                description: valid.description ?? task.description,
                tags: valid.tags === undefined ? task.tags : unique(valid.tags),
                assignee:
                  valid.assignee === undefined ? task.assignee : (valid.assignee ?? undefined),
                dependsOn: valid.dependsOn === undefined ? task.dependsOn : unique(valid.dependsOn),
                extra: valid.extra ?? task.extra,
              }
              const next = replaceTask(state, updated)
              yield* ensureAcyclic(allTasks(next))
              return [updated, next] as const
            }),
          ),

        move: (id, placement) =>
          transact((state) =>
            Effect.gen(function* () {
              const where = yield* validate(Placement, placement)
              const { task } = yield* findOpen(state, id, "move")
              if (where.before === id || where.after === id) {
                return yield* new ValidationError({
                  issues: [`task ${id} cannot be placed next to itself`],
                })
              }
              const rest = withoutTask(state, id)
              const target = yield* resolve(rest, where)
              const moved: Task = { ...task, group: target.group }
              return [moved, insert(rest, target.group, target.index, moved)] as const
            }),
          ),
```

4. Run `bun run fix`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test test/spec/MemoryTodoStore.test.ts`
Expected: `31 pass`, `0 fail`.

- [ ] **Step 5: Run the gate and commit**

```bash
bun run check
git add src/spec/testing/conformance src/spec/MemoryTodoStore.ts
git commit -m "Update and move tasks in the in-memory store" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014ak6bnNqeftYod6YDrWkcK"
```

---

### Task 7: renameGroup and comment

**Files:**
- Create: `src/spec/testing/conformance/groups.ts`, `src/spec/testing/conformance/comments.ts`
- Modify: `src/spec/testing/conformance/index.ts`, `src/spec/MemoryTodoStore.ts`
- Test: `test/spec/MemoryTodoStore.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces:
  - **`renameGroup(from, to)`** renames an open group and its tasks' `group`. Done tasks keep their recorded name. It fails with `GroupNotFound` for an unknown group, and `ValidationError` for a taken or invalid name.
  - **`comment(id, input)`** prepends a `Comment` stamped with `DateTime.now`.
  - **Completion:** after this task, `MemoryTodoStore` implements the whole contract, and the `notYet` helper is gone.

- [ ] **Step 1: Write the group and comment cases**

Create `src/spec/testing/conformance/groups.ts`:

```ts
import { Effect } from "effect"
import { TodoStore } from "../../TodoStore.ts"
import { equal, failsWith, layout } from "./assert.ts"
import type { ConformanceCase } from "./case.ts"

export const groupCases: ReadonlyArray<ConformanceCase> = [
  {
    name: "renameGroup renames a group in place, updating its tasks",
    requires: ["groups", "renameGroup"],
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const a = yield* store.add({ title: "A" }, { group: "Backend" })
      const b = yield* store.add({ title: "B" }, { group: "Frontend" })
      yield* store.renameGroup("Backend", "Server")
      equal((yield* store.get(a.id)).group, "Server")
      equal(yield* layout, [
        ["", []],
        ["Server", [a.id]],
        ["Frontend", [b.id]],
      ])
    }),
  },
  {
    name: "renameGroup leaves done tasks with the group they were completed in",
    requires: ["groups", "renameGroup"],
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const a = yield* store.add({ title: "A" }, { group: "Backend" })
      yield* store.add({ title: "B" }, { group: "Backend" })
      yield* store.complete(a.id)
      yield* store.renameGroup("Backend", "Server")
      equal((yield* store.get(a.id)).group, "Backend")
    }),
  },
  {
    name: "renameGroup rejects unknown groups and taken or invalid names, changing nothing",
    requires: ["groups", "renameGroup"],
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const a = yield* store.add({ title: "A" }, { group: "Backend" })
      const b = yield* store.add({ title: "B" }, { group: "Frontend" })
      yield* failsWith(store.renameGroup("Nope", "Other"), "GroupNotFound")
      yield* failsWith(store.renameGroup("Backend", "Frontend"), "ValidationError")
      yield* failsWith(store.renameGroup("Backend", ""), "ValidationError")
      equal(yield* layout, [
        ["", []],
        ["Backend", [a.id]],
        ["Frontend", [b.id]],
      ])
    }),
  },
  {
    name: "reopen falls back to the ungrouped tasks when the recorded group is gone",
    requires: ["groups", "renameGroup"],
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const a = yield* store.add({ title: "A" }, { group: "Backend" })
      yield* store.complete(a.id)
      yield* store.renameGroup("Backend", "Server")
      equal((yield* store.reopen(a.id)).group, undefined)
      equal(yield* layout, [
        ["", [a.id]],
        ["Server", []],
      ])
    }),
  },
]
```

Create `src/spec/testing/conformance/comments.ts`:

```ts
import { DateTime, Effect } from "effect"
import { TestClock } from "effect/testing"
import { TodoStore } from "../../TodoStore.ts"
import { equal, failsWith } from "./assert.ts"
import type { ConformanceCase } from "./case.ts"

const at = Date.parse("2026-09-12T12:00:00Z")

export const commentCases: ReadonlyArray<ConformanceCase> = [
  {
    name: "comment adds comments newest first, stamped with the current time",
    requires: ["comments"],
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      yield* TestClock.setTime(at)
      const task = yield* store.add({ title: "Add rate limiting" })
      const first = yield* store.comment(task.id, {
        author: "lemol",
        body: "Do this after the login fix.",
      })
      yield* TestClock.adjust("1 minute")
      yield* store.comment(task.id, { author: "claude", body: "Started on the token bucket." })
      equal(first.author, "lemol")
      equal(DateTime.toEpochMillis(first.at), at)
      const { comments } = yield* store.get(task.id)
      equal(
        comments.map((c) => [c.author, c.body]),
        [
          ["claude", "Started on the token bucket."],
          ["lemol", "Do this after the login fix."],
        ],
      )
    }),
  },
  {
    name: "comment works on a done task",
    requires: ["comments"],
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const task = yield* store.add({ title: "Ship it" })
      yield* store.complete(task.id)
      yield* store.comment(task.id, { author: "lemol", body: "Shipped in 0.1." })
      equal((yield* store.get(task.id)).comments.length, 1)
    }),
  },
  {
    name: "comment rejects invalid input and unknown tasks, changing nothing",
    requires: ["comments"],
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const task = yield* store.add({ title: "Task" })
      yield* failsWith(store.comment(task.id, { author: "le mol", body: "Hi." }), "ValidationError")
      yield* failsWith(store.comment(task.id, { author: "lemol", body: "" }), "ValidationError")
      yield* failsWith(
        store.comment("does-not-exist", { author: "lemol", body: "Hi." }),
        "TaskNotFound",
      )
      equal((yield* store.get(task.id)).comments, [])
    }),
  },
]
```

Replace `src/spec/testing/conformance/index.ts` with:

```ts
import { describe } from "bun:test"
import { Effect, type Layer } from "effect"
import { TodoStore } from "../../TodoStore.ts"
import { effectTest } from "../effectTest.ts"
import { addingCases } from "./adding.ts"
import type { ConformanceCase } from "./case.ts"
import { commentCases } from "./comments.ts"
import { groupCases } from "./groups.ts"
import { lifecycleCases } from "./lifecycle.ts"
import { movingCases } from "./moving.ts"
import { readingCases } from "./reading.ts"
import { updatingCases } from "./updating.ts"

/** Every conformance case, as runner-agnostic Effects. */
export const conformanceCases: ReadonlyArray<ConformanceCase> = [
  ...readingCases,
  ...addingCases,
  ...updatingCases,
  ...movingCases,
  ...lifecycleCases,
  ...groupCases,
  ...commentCases,
]

/**
 * Registers every conformance case with `bun:test`. `layer` must build a fresh,
 * empty store each time it is provided; each case gets its own.
 */
export const runConformance = <E>(name: string, layer: Layer.Layer<TodoStore, E>): void =>
  describe(`${name} conforms to TodoStore`, () => {
    for (const testCase of conformanceCases) {
      effectTest(
        testCase.name,
        Effect.gen(function* () {
          const { capabilities } = yield* TodoStore
          if (testCase.requires?.some((capability) => !capabilities[capability])) return
          yield* testCase.run
        }),
        layer,
      )
    }
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/spec/MemoryTodoStore.test.ts`
Expected: `31 pass`, `7 fail`. The failures die with `MemoryTodoStore.renameGroup is not implemented yet` or `MemoryTodoStore.comment is not implemented yet`.

- [ ] **Step 3: Implement the operations**

In `src/spec/MemoryTodoStore.ts`, make these four edits:

1. Replace the three `import` lines from `"effect"`, `"./errors.ts"` and `"./model.ts"` with:

```ts
import { DateTime, Effect, Layer, SynchronizedRef } from "effect"
import { GroupNotFound, InvalidTransition, TaskNotFound, ValidationError } from "./errors.ts"
import {
  type Comment,
  CommentInput,
  Label,
  Placement,
  type Task,
  type TaskId,
  TaskInput,
  TaskPatch,
  type TodoList,
} from "./model.ts"
```

2. Replace `renameGroup: notYet("renameGroup"),` and `comment: notYet("comment"),` with:

```ts
        renameGroup: (from, to) =>
          transact((state) =>
            Effect.gen(function* () {
              if (!state.sections.some((section) => section.name === from)) {
                return yield* new GroupNotFound({ name: from })
              }
              const name = yield* validate(Label, to)
              if (name !== from && state.sections.some((section) => section.name === name)) {
                return yield* new ValidationError({ issues: [`group ${name} already exists`] })
              }
              const sections = state.sections.map((section) =>
                section.name === from
                  ? {
                      ...section,
                      name,
                      tasks: section.tasks.map((task) => ({ ...task, group: name })),
                    }
                  : section,
              )
              return [undefined, { ...state, sections }] as const
            }),
          ),

        comment: (id, input) =>
          transact((state) =>
            Effect.gen(function* () {
              const valid = yield* validate(CommentInput, input)
              const task = yield* findTask(state, id)
              const comment: Comment = {
                author: valid.author,
                body: valid.body,
                at: yield* DateTime.now,
              }
              return [
                comment,
                replaceTask(state, { ...task, comments: [comment, ...task.comments] }),
              ] as const
            }),
          ),
```

3. Delete the `notYet` helper, including its doc comment:

```ts
/** Stands in for an operation a later step implements. */
const notYet = (operation: string) => () =>
  Effect.die(new Error(`MemoryTodoStore.${operation} is not implemented yet`))
```

4. Run `bun run fix`.

The finished file must match this:

```ts
/**
 * The reference `TodoStore`: the whole list lives in memory. It is the
 * simplest executable statement of the operation semantics in spec §1.4.
 */

import { DateTime, Effect, Layer, SynchronizedRef } from "effect"
import { GroupNotFound, InvalidTransition, TaskNotFound, ValidationError } from "./errors.ts"
import {
  type Comment,
  CommentInput,
  Label,
  Placement,
  type Task,
  type TaskId,
  TaskInput,
  TaskPatch,
  type TodoList,
} from "./model.ts"
import { allCapabilities, TodoStore } from "./TodoStore.ts"
import { ensureAcyclic, unique, validate } from "./validation.ts"

interface Section {
  /** `undefined` for the ungrouped section, which is always first. */
  readonly name: string | undefined
  readonly description: string
  readonly tasks: ReadonlyArray<Task>
}

interface State {
  readonly title: string
  readonly description: string
  readonly sections: ReadonlyArray<Section>
  /** Done tasks, most recently completed first. */
  readonly done: ReadonlyArray<Task>
  readonly lastId: number
}

interface Located {
  readonly sectionIndex: number
  readonly taskIndex: number
  readonly task: Task
}

const locateOpen = (state: State, id: TaskId): Located | undefined => {
  for (const [sectionIndex, section] of state.sections.entries()) {
    const taskIndex = section.tasks.findIndex((task) => task.id === id)
    const task = section.tasks[taskIndex]
    if (task !== undefined) return { sectionIndex, taskIndex, task }
  }
  return undefined
}

const findTask = (state: State, id: TaskId): Effect.Effect<Task, TaskNotFound> => {
  const task = locateOpen(state, id)?.task ?? state.done.find((done) => done.id === id)
  return task === undefined ? Effect.fail(new TaskNotFound({ id })) : Effect.succeed(task)
}

const findOpen = (
  state: State,
  id: TaskId,
  operation: string,
): Effect.Effect<Located, TaskNotFound | InvalidTransition> => {
  const located = locateOpen(state, id)
  if (located !== undefined) return Effect.succeed(located)
  return Effect.fail(
    state.done.some((task) => task.id === id)
      ? new InvalidTransition({ id, status: "done", operation })
      : new TaskNotFound({ id }),
  )
}

const allTasks = (state: State): ReadonlyArray<Task> => [
  ...state.sections.flatMap((section) => section.tasks),
  ...state.done,
]

const withoutTask = (state: State, id: TaskId): State => ({
  ...state,
  sections: state.sections.map((section) => ({
    ...section,
    tasks: section.tasks.filter((task) => task.id !== id),
  })),
  done: state.done.filter((task) => task.id !== id),
})

const replaceTask = (state: State, updated: Task): State => ({
  ...state,
  sections: state.sections.map((section) => ({
    ...section,
    tasks: section.tasks.map((task) => (task.id === updated.id ? updated : task)),
  })),
  done: state.done.map((task) => (task.id === updated.id ? updated : task)),
})

/** The index just past the last task of `group`, or 0 if the group does not exist. */
const endOf = (state: State, group: string | undefined): number =>
  state.sections.find((section) => section.name === group)?.tasks.length ?? 0

/** Inserts `task` into `group` (created at the end of the list if missing) at `index`. */
const insert = (state: State, group: string | undefined, index: number, task: Task): State => {
  const sections = state.sections.some((section) => section.name === group)
    ? state.sections
    : [...state.sections, { name: group, description: "", tasks: [] }]
  return {
    ...state,
    sections: sections.map((section) =>
      section.name === group
        ? {
            ...section,
            tasks: [
              ...section.tasks.slice(0, index),
              { ...task, group },
              ...section.tasks.slice(index),
            ],
          }
        : section,
    ),
  }
}

/** Resolves a placement against `state`, which must not contain the task being placed. */
const resolve = (
  state: State,
  placement: Placement,
): Effect.Effect<
  { readonly group: string | undefined; readonly index: number },
  TaskNotFound | ValidationError
> => {
  if (placement.before !== undefined && placement.after !== undefined) {
    return Effect.fail(
      new ValidationError({ issues: ["a placement takes before or after, not both"] }),
    )
  }
  const anchorId = placement.before ?? placement.after
  if (anchorId === undefined) {
    return Effect.succeed({ group: placement.group, index: endOf(state, placement.group) })
  }
  const anchor = locateOpen(state, anchorId)
  if (anchor === undefined) return Effect.fail(new TaskNotFound({ id: anchorId }))
  const group = state.sections[anchor.sectionIndex]?.name
  if (placement.group !== undefined && placement.group !== group) {
    return Effect.fail(
      new ValidationError({ issues: [`task ${anchorId} is not in group ${placement.group}`] }),
    )
  }
  const index = placement.before !== undefined ? anchor.taskIndex : anchor.taskIndex + 1
  return Effect.succeed({ group, index })
}

export interface Options {
  readonly title?: string
  readonly description?: string
}

/** Builds a fresh, empty in-memory store each time the layer is provided. */
export const layer = (options: Options = {}): Layer.Layer<TodoStore> =>
  Layer.effect(
    TodoStore,
    Effect.gen(function* () {
      const ref = yield* SynchronizedRef.make<State>({
        title: options.title ?? "",
        description: options.description ?? "",
        sections: [{ name: undefined, description: "", tasks: [] }],
        done: [],
        lastId: 0,
      })

      const read = SynchronizedRef.get(ref)

      // The new state is kept only if `f` succeeds, so failed operations change nothing.
      const transact = <A, E>(f: (state: State) => Effect.Effect<readonly [A, State], E>) =>
        SynchronizedRef.modifyEffect(ref, f)

      return TodoStore.of({
        capabilities: allCapabilities,

        load: () =>
          Effect.map(read, (state): TodoList => {
            const [ungrouped, ...groups] = state.sections
            return {
              title: state.title,
              description: state.description,
              ungrouped: ungrouped?.tasks ?? [],
              groups: groups.map((section) => ({
                name: section.name ?? "",
                description: section.description,
                tasks: section.tasks,
              })),
            }
          }),

        get: (id) => Effect.flatMap(read, (state) => findTask(state, id)),

        listDone: () => Effect.map(read, (state) => state.done),

        add: (input, placement = {}) =>
          transact((state) =>
            Effect.gen(function* () {
              const valid = yield* validate(TaskInput, input)
              const where = yield* validate(Placement, placement)
              const target = yield* resolve(state, where)
              const task: Task = {
                id: String(state.lastId + 1),
                title: valid.title,
                description: valid.description ?? "",
                status: "open",
                tags: unique(valid.tags ?? []),
                assignee: valid.assignee,
                dependsOn: unique(valid.dependsOn ?? []),
                comments: [],
                group: target.group,
                extra: valid.extra ?? {},
              }
              const next = insert(
                { ...state, lastId: state.lastId + 1 },
                target.group,
                target.index,
                task,
              )
              yield* ensureAcyclic(allTasks(next))
              return [task, next] as const
            }),
          ),

        update: (id, patch) =>
          transact((state) =>
            Effect.gen(function* () {
              const valid = yield* validate(TaskPatch, patch)
              const task = yield* findTask(state, id)
              const updated: Task = {
                ...task,
                title: valid.title ?? task.title,
                description: valid.description ?? task.description,
                tags: valid.tags === undefined ? task.tags : unique(valid.tags),
                assignee:
                  valid.assignee === undefined ? task.assignee : (valid.assignee ?? undefined),
                dependsOn: valid.dependsOn === undefined ? task.dependsOn : unique(valid.dependsOn),
                extra: valid.extra ?? task.extra,
              }
              const next = replaceTask(state, updated)
              yield* ensureAcyclic(allTasks(next))
              return [updated, next] as const
            }),
          ),

        move: (id, placement) =>
          transact((state) =>
            Effect.gen(function* () {
              const where = yield* validate(Placement, placement)
              const { task } = yield* findOpen(state, id, "move")
              if (where.before === id || where.after === id) {
                return yield* new ValidationError({
                  issues: [`task ${id} cannot be placed next to itself`],
                })
              }
              const rest = withoutTask(state, id)
              const target = yield* resolve(rest, where)
              const moved: Task = { ...task, group: target.group }
              return [moved, insert(rest, target.group, target.index, moved)] as const
            }),
          ),

        complete: (id) =>
          transact((state) =>
            Effect.gen(function* () {
              const { task } = yield* findOpen(state, id, "complete")
              const done: Task = { ...task, status: "done", completedAt: yield* DateTime.now }
              const rest = withoutTask(state, id)
              return [done, { ...rest, done: [done, ...rest.done] }] as const
            }),
          ),

        reopen: (id) =>
          transact((state) =>
            Effect.gen(function* () {
              const task = state.done.find((done) => done.id === id)
              if (task === undefined) {
                return yield* Effect.fail(
                  locateOpen(state, id) === undefined
                    ? new TaskNotFound({ id })
                    : new InvalidTransition({ id, status: "open", operation: "reopen" }),
                )
              }
              const group = state.sections.some(
                (section) => section.name !== undefined && section.name === task.group,
              )
                ? task.group
                : undefined
              const reopened: Task = { ...task, status: "open", completedAt: undefined, group }
              const rest = withoutTask(state, id)
              return [reopened, insert(rest, group, endOf(rest, group), reopened)] as const
            }),
          ),

        remove: (id) =>
          transact((state) =>
            Effect.gen(function* () {
              yield* findTask(state, id)
              return [undefined, withoutTask(state, id)] as const
            }),
          ),

        renameGroup: (from, to) =>
          transact((state) =>
            Effect.gen(function* () {
              if (!state.sections.some((section) => section.name === from)) {
                return yield* new GroupNotFound({ name: from })
              }
              const name = yield* validate(Label, to)
              if (name !== from && state.sections.some((section) => section.name === name)) {
                return yield* new ValidationError({ issues: [`group ${name} already exists`] })
              }
              const sections = state.sections.map((section) =>
                section.name === from
                  ? {
                      ...section,
                      name,
                      tasks: section.tasks.map((task) => ({ ...task, group: name })),
                    }
                  : section,
              )
              return [undefined, { ...state, sections }] as const
            }),
          ),

        comment: (id, input) =>
          transact((state) =>
            Effect.gen(function* () {
              const valid = yield* validate(CommentInput, input)
              const task = yield* findTask(state, id)
              const comment: Comment = {
                author: valid.author,
                body: valid.body,
                at: yield* DateTime.now,
              }
              return [
                comment,
                replaceTask(state, { ...task, comments: [comment, ...task.comments] }),
              ] as const
            }),
          ),

        diagnostics: () => Effect.succeed([]),
      })
    }),
  )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test test/spec/MemoryTodoStore.test.ts`
Expected: `38 pass`, `0 fail`. Also run `grep -n notYet src/spec/MemoryTodoStore.ts`; it should print nothing.

- [ ] **Step 5: Run the gate and commit**

```bash
bun run check
git add src/spec/testing/conformance src/spec/MemoryTodoStore.ts
git commit -m "Rename groups and comment on tasks in the in-memory store" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014ak6bnNqeftYod6YDrWkcK"
```

---

### Task 8: Public entry point and docs

**Files:**
- Modify: `src/spec/index.ts` (replace the `export {}` placeholder)
- Modify: `src/spec/README.md`, `docs/architecture.md`
- Test: `test/spec/index.test.ts`

**Interfaces:**
- Consumes: every module above.
- Produces: `@lemol/todo-md/spec`, which re-exports `diagnostic`, `errors`, `graph`, `model`, `TodoStore` and `validation`, plus `MemoryTodoStore` as a namespace (`MemoryTodoStore.layer()`). This is the surface Plans 2–5 import.

- [ ] **Step 1: Write the failing test**

Create `test/spec/index.test.ts`:

```ts
import { expect, test } from "bun:test"
import * as spec from "../../src/spec/index.ts"

test("the public entry point exposes the model, contract, reference store and helpers", () => {
  expect(spec.TodoStore.key).toBe("@lemol/todo-md/spec/TodoStore")
  expect(spec.allCapabilities).toEqual({
    groups: true,
    reorder: true,
    renameGroup: true,
    comments: true,
  })
  expect(typeof spec.MemoryTodoStore.layer).toBe("function")
  for (const name of ["Task", "TaskInput", "TaskNotFound", "Diagnostic", "findCycle", "validate"]) {
    expect(spec).toHaveProperty(name)
  }
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/spec/index.test.ts`
Expected: FAIL with `TypeError: undefined is not an object (evaluating 'spec.TodoStore.key')`. `src/spec/index.ts` is still `export {}`.

- [ ] **Step 3: Write the entry point**

Replace the contents of `src/spec/index.ts` with:

```ts
export * from "./diagnostic.ts"
export * from "./errors.ts"
export * from "./graph.ts"
export * as MemoryTodoStore from "./MemoryTodoStore.ts"
export * from "./model.ts"
export * from "./TodoStore.ts"
export * from "./validation.ts"
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test test/spec/index.test.ts`
Expected: `1 pass`, `0 fail`.

- [ ] **Step 5: Update the docs**

In `src/spec/README.md`:

1. Replace `> Status: scaffolded, not implemented yet.` with `> Status: implemented for spec 0.1.`

2. Add this row to the end of the first **Contents** table:

   ```markdown
   | Helpers             | `findCycle`, `validate` (schema decode → `ValidationError`), `ensureAcyclic`, `unique`, for adapters and `core`. |
   ```

3. Replace the `conformanceCases` row of the testing table with:

   ```markdown
   | `conformanceCases`              | The runner-agnostic conformance cases, each an Effect over a `TodoStore`. They assert with `node:assert`, so they need no particular test runner. |
   | `equal`, `failsWith`, `layout`  | The assertion helpers the cases use, for adapter-specific tests. |
   ```

4. In **Writing an adapter**, replace step 3 with:

   ```markdown
   3. In your tests, call `runConformance("YourStore", YourStore.layer)`. The
      layer must build a fresh, empty store each time it is provided.
   ```

In `docs/architecture.md`, in the **Reference implementation and conformance** list, replace the bullet that begins `**The conformance suite** (in \`spec\`)` with:

```markdown
- **The conformance suite** (in `spec`) is a list of runner-agnostic cases,
  each an Effect that runs against a fresh store and asserts with
  `node:assert`. `runConformance(name, layer)` registers them with
  `bun:test`. Every adapter's test suite calls it, and `MemoryTodoStore`
  passes it too. The spec's operation semantics are therefore tested, not
  only written down.
```

- [ ] **Step 6: Run the gate and commit**

Run: `bun run check`
Expected: lint and typecheck clean; `61 pass`, `0 fail` across 7 files.

```bash
git add src/spec/index.ts test/spec/index.test.ts src/spec/README.md docs/architecture.md
git commit -m "Expose the spec module's public entry point" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014ak6bnNqeftYod6YDrWkcK"
```
