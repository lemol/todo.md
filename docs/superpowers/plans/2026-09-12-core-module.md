# core Module Implementation Plan (Plan 4 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `@lemol/todo-md/core`: `TodoService`, the adapter-agnostic logic every frontend uses. It provides:
- queries with derived state (`list`, `next`, `show`);
- `check`, which merges the store's diagnostics with the model checks;
- guarded mutations, including the capability guard, `remove` with dependents, and `complete` reporting what it unblocked.

**Architecture:**
- **Pure functions** compute each task's state from the open list and the done tasks (spec §1.3), filter tasks, and run the model checks of spec §1.6.
- **`TodoService.layer`** wraps any `TodoStore`. It reads through `load` and `listDone` and delegates mutations after the capability guard.
- **Imports:** `core` imports only `spec` and `effect`.

**Tech Stack:** Bun 1.4, TypeScript 7, Effect `4.0.0-rc.108` (`Context.Service`, `Layer`, `Schema.TaggedError`), `bun:test`, Biome.

**Spec:**
- [`docs/spec.md`](../../spec.md): §1.3 (derived state), §1.5 (capabilities) and §1.6 (checks).
- [`docs/architecture.md`](../../architecture.md): "core".
- [`src/core/README.md`](../../../src/core/README.md): this module's contents.
- Tests run against `MemoryTodoStore` from Plan 1.

**Where this plan sits:**

1. `spec` (done)
2. `markdown` (done)
3. `fs` (done)
4. `core` (this plan)
5. `cli`

## Global Constraints

- **Imports.** `src/core/**` may import only its own files, `../spec/index.ts` and `effect`, and never an adapter; `test/boundaries.test.ts` enforces this. Tests may also import `src/spec/testing.ts`.
- **Read the Effect guide first.** Read `node_modules/effect/AGENTS.md` before writing Effect code. Services are yielded directly (`yield* TodoStore`) and have no `.asEffect()`.
- **Imports end in `.ts`** and are relative.
- **Formatting.** Biome: double quotes, no semicolons, 2-space indent, width 100. Run `bun run fix` after editing; code here is already formatted.
- **Gate.** `bun run check` must pass before every commit.
- **Commits.** Commit messages are plain sentences ending with:

  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_014ak6bnNqeftYod6YDrWkcK
  ```

## Decisions this plan makes

Task 4 records them in the docs.

- **Stores reject new cycles; `core` doesn't.** The architecture doc said `core` would re-check cycles on `add` and `update`. Spec §1.6 already requires stores to, and the conformance suite enforces it, so `core` doesn't repeat the work on every write. `check()` still reports existing cycles (for example, from hand edits).
- **`remove` refuses with a new error.** `HasDependents { id, dependents }` is `core`'s own error for "open tasks still depend on this". `remove(id, { force: true })` skips the check.
- **`complete` returns a `Completion`**, `{ task, unblocked }`, so a caller (an agent) learns which tasks just became ready.
- **`check()` never double-reports.** A model diagnostic is dropped when the store already reported the same code for the same task. The `fs` store, for example, reports `duplicate-id` itself.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/core/views.ts` | `TaskState`, `TaskView`, `SectionView`, `viewOf`, `inPriorityOrder`, `Board`, `boardOf`, `allTasks`, `view` |
| `src/core/filter.ts` | `TaskFilter`, `matches` |
| `src/core/check.ts` | `modelDiagnostics`, `mergeDiagnostics` |
| `src/core/errors.ts` | `HasDependents` |
| `src/core/TodoService.ts` | `Listing`, `Dependency`, `TaskDetail`, `Completion`, `TodoService` and its `layer` |
| `src/core/index.ts` | Public entry point `@lemol/todo-md/core` |
| `test/core/fixtures.ts` | `task(fields)`: a `Task` with defaults |

`src/core/index.ts` exists today as an `export {}` placeholder.

---

### Task 1: Derived state and filters

**Files:**
- Create: `src/core/views.ts`, `src/core/filter.ts`
- Test: `test/core/fixtures.ts`, `test/core/views.test.ts`, `test/core/filter.test.ts`

**Interfaces:**
- Consumes: `Task`, `TaskId` and `TodoList` from `spec`.
- Produces:
  - `type TaskState = "ready" | "blocked" | "done"`
  - `interface TaskView { task; state; blockedBy: ReadonlyArray<TaskId> }`
  - `interface SectionView { name: string | undefined; description; tasks: ReadonlyArray<TaskView> }`
  - `viewOf(task, doneIds): TaskView` and `inPriorityOrder(list): Task[]`
  - `interface Board { list; done; doneIds }`, `boardOf(list, done)`, `allTasks(board)` and `view(board) => (task) => TaskView`
  - `interface TaskFilter { status?: "open" | "done" | "all"; state?: "ready" | "blocked"; tags?; assignee?; group? }` and `matches(filter) => (view) => boolean`. `status` is applied by `TodoService.list`, not by `matches`.

- [ ] **Step 1: Write the failing tests**

Create `test/core/fixtures.ts`:

```ts
import type { Task } from "../../src/spec/index.ts"

/** A task with defaults, overridden by `fields`. */
export const task = (fields: Partial<Task> & Pick<Task, "id">): Task => ({
  title: `Task ${fields.id}`,
  description: "",
  status: "open",
  tags: [],
  assignee: undefined,
  dependsOn: [],
  comments: [],
  group: undefined,
  completedAt: undefined,
  extra: {},
  ...fields,
})
```

Create `test/core/views.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { allTasks, boardOf, inPriorityOrder, viewOf } from "../../src/core/views.ts"
import { task } from "./fixtures.ts"

describe("viewOf", () => {
  const done = new Set(["1"])

  test("an open task whose dependencies are all done is ready", () => {
    expect(viewOf(task({ id: "2", dependsOn: ["1"] }), done)).toMatchObject({
      state: "ready",
      blockedBy: [],
    })
  })

  test("an open task with an unfinished or unknown dependency is blocked by it", () => {
    expect(viewOf(task({ id: "3", dependsOn: ["1", "2", "9"] }), done)).toMatchObject({
      state: "blocked",
      blockedBy: ["2", "9"],
    })
  })

  test("a done task is done, whatever its dependencies", () => {
    expect(viewOf(task({ id: "4", status: "done", dependsOn: ["2"] }), done)).toMatchObject({
      state: "done",
      blockedBy: [],
    })
  })
})

describe("boards", () => {
  const list = {
    title: "T",
    description: "",
    ungrouped: [task({ id: "1" })],
    groups: [
      { name: "A", description: "", tasks: [task({ id: "2" }), task({ id: "3" })] },
      { name: "B", description: "", tasks: [task({ id: "4" })] },
    ],
  }

  test("inPriorityOrder lists ungrouped tasks first, then each group in order", () => {
    expect(inPriorityOrder(list).map((t) => t.id)).toEqual(["1", "2", "3", "4"])
  })

  test("a board knows every task and the done IDs", () => {
    const board = boardOf(list, [task({ id: "5", status: "done" })])
    expect(allTasks(board).map((t) => t.id)).toEqual(["1", "2", "3", "4", "5"])
    expect(board.doneIds).toEqual(new Set(["5"]))
  })
})
```

Create `test/core/filter.test.ts`:

```ts
import { expect, test } from "bun:test"
import { matches } from "../../src/core/filter.ts"
import { viewOf } from "../../src/core/views.ts"
import { task } from "./fixtures.ts"

const view = viewOf(
  task({ id: "1", tags: ["api", "bug"], assignee: "lemol", group: "Backend", dependsOn: ["9"] }),
  new Set(),
)

test.each([
  ["no conditions", {}, true],
  ["all of its tags", { tags: ["bug", "api"] }, true],
  ["a tag it lacks", { tags: ["bug", "ui"] }, false],
  ["its assignee", { assignee: "lemol" }, true],
  ["another assignee", { assignee: "claude" }, false],
  ["its group", { group: "Backend" }, true],
  ["another group", { group: "Frontend" }, false],
  ["its state", { state: "blocked" as const }, true],
  ["another state", { state: "ready" as const }, false],
])("a filter on %s matches: %p", (_label, filter, expected) => {
  expect(matches(filter)(view)).toBe(expected)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/core`
Expected: FAIL with `Cannot find module '../../src/core/views.ts'` (and `filter.ts`).

- [ ] **Step 3: Write the views**

Create `src/core/views.ts`:

```ts
import type { Task, TaskId, TodoList } from "../spec/index.ts"

/** A task's derived state (spec §1.3). */
export type TaskState = "ready" | "blocked" | "done"

/** A task with its derived state. */
export interface TaskView {
  readonly task: Task
  readonly state: TaskState
  /** Dependencies that are not done yet, including unknown IDs; empty unless blocked. */
  readonly blockedBy: ReadonlyArray<TaskId>
}

export interface SectionView {
  /** `undefined` for the ungrouped section, which is always first. */
  readonly name: string | undefined
  readonly description: string
  readonly tasks: ReadonlyArray<TaskView>
}

/** The derived state of `task`, given the IDs of all done tasks. */
export const viewOf = (task: Task, doneIds: ReadonlySet<TaskId>): TaskView => {
  if (task.status === "done") return { task, state: "done", blockedBy: [] }
  const blockedBy = task.dependsOn.filter((id) => !doneIds.has(id))
  return { task, state: blockedBy.length === 0 ? "ready" : "blocked", blockedBy }
}

/** Open tasks in priority order: ungrouped first, then each group in order (spec §1.3). */
export const inPriorityOrder = (list: TodoList): ReadonlyArray<Task> => [
  ...list.ungrouped,
  ...list.groups.flatMap((group) => group.tasks),
]

/** Everything needed to derive state: the open list and the done tasks. */
export interface Board {
  readonly list: TodoList
  readonly done: ReadonlyArray<Task>
  readonly doneIds: ReadonlySet<TaskId>
}

export const boardOf = (list: TodoList, done: ReadonlyArray<Task>): Board => ({
  list,
  done,
  doneIds: new Set(done.map((task) => task.id)),
})

/** All tasks on the board, open (in priority order) then done. */
export const allTasks = (board: Board): ReadonlyArray<Task> => [
  ...inPriorityOrder(board.list),
  ...board.done,
]

export const view =
  (board: Board) =>
  (task: Task): TaskView =>
    viewOf(task, board.doneIds)
```

- [ ] **Step 4: Write the filter**

Create `src/core/filter.ts`:

```ts
import type { TaskView } from "./views.ts"

/** Which tasks a query returns. Absent fields do not filter. */
export interface TaskFilter {
  /** Open tasks (the default), done tasks, or both. */
  readonly status?: "open" | "done" | "all"
  /** Only open tasks in this state. */
  readonly state?: "ready" | "blocked"
  /** Tasks carrying every one of these tags. */
  readonly tags?: ReadonlyArray<string>
  readonly assignee?: string
  /** Tasks in (open) or completed in (done) this group. */
  readonly group?: string
}

/** Whether a task passes the filter's state, tag, assignee and group conditions. */
export const matches =
  (filter: TaskFilter) =>
  (view: TaskView): boolean =>
    (filter.state === undefined || view.state === filter.state) &&
    (filter.tags ?? []).every((tag) => view.task.tags.includes(tag)) &&
    (filter.assignee === undefined || view.task.assignee === filter.assignee) &&
    (filter.group === undefined || view.task.group === filter.group)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test test/core`
Expected: `14 pass`, `0 fail`.

- [ ] **Step 6: Run the gate and commit**

```bash
bun run check
git add src/core/views.ts src/core/filter.ts test/core
git commit -m "Derive task state and filter tasks in core" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014ak6bnNqeftYod6YDrWkcK"
```

---

### Task 2: Model checks

**Files:**
- Create: `src/core/check.ts`
- Test: `test/core/check.test.ts`

**Interfaces:**
- Consumes: `Diagnostic`, `findCycle`, `Task` and `TaskId` from `spec`; `task` from the fixtures.
- Produces:
  - `modelDiagnostics(tasks): ReadonlyArray<Diagnostic>`. It reports `duplicate-id` once per ID, `unknown-dependency` per missing dependency, `self-dependency`, and one `dependency-cycle` (the first found, listing its IDs).
  - `mergeDiagnostics(store, model)`, which drops a model diagnostic whose code and task the store already reported.

- [ ] **Step 1: Write the failing test**

Create `test/core/check.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { mergeDiagnostics, modelDiagnostics } from "../../src/core/check.ts"
import { task } from "./fixtures.ts"

const codes = (tasks: Parameters<typeof modelDiagnostics>[0]) =>
  modelDiagnostics(tasks).map((d) => [d.code, d.taskId])

describe("modelDiagnostics", () => {
  test("finds nothing wrong in a consistent list", () => {
    expect(codes([task({ id: "1" }), task({ id: "2", dependsOn: ["1"] })])).toEqual([])
  })

  test("reports duplicate IDs once", () => {
    expect(codes([task({ id: "1" }), task({ id: "1", status: "done" })])).toEqual([
      ["duplicate-id", "1"],
    ])
  })

  test("reports dependencies on unknown IDs", () => {
    expect(codes([task({ id: "1", dependsOn: ["9"] })])).toEqual([["unknown-dependency", "1"]])
  })

  test("reports a self-dependency without also reporting it as a cycle", () => {
    expect(codes([task({ id: "3", dependsOn: ["3"] })])).toEqual([["self-dependency", "3"]])
  })

  test("reports a cycle with the IDs along it", () => {
    const [diagnostic] = modelDiagnostics([
      task({ id: "1", dependsOn: ["2"] }),
      task({ id: "2", dependsOn: ["1"] }),
    ])
    expect(diagnostic).toMatchObject({
      code: "dependency-cycle",
      message: "dependency cycle: 1 → 2 → 1",
      taskId: "1",
    })
  })
})

test("mergeDiagnostics skips model diagnostics the store already reported", () => {
  const store = [
    { severity: "error" as const, code: "duplicate-id", message: "from the store", taskId: "1" },
  ]
  const model = [
    { severity: "error" as const, code: "duplicate-id", message: "from the model", taskId: "1" },
    {
      severity: "error" as const,
      code: "unknown-dependency",
      message: "from the model",
      taskId: "2",
    },
  ]
  expect(mergeDiagnostics(store, model).map((d) => d.message)).toEqual([
    "from the store",
    "from the model",
  ])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/core/check.test.ts`
Expected: FAIL with `Cannot find module '../../src/core/check.ts'`.

- [ ] **Step 3: Write the checks**

Create `src/core/check.ts`:

```ts
import { type Diagnostic, findCycle, type Task, type TaskId } from "../spec/index.ts"

/**
 * The model-level checks of spec §1.6 over every task, open and done:
 * duplicate IDs, dependencies on unknown IDs, self-dependencies and cycles.
 */
export const modelDiagnostics = (tasks: ReadonlyArray<Task>): ReadonlyArray<Diagnostic> => {
  const diagnostics: Diagnostic[] = []
  const counts = new Map<TaskId, number>()
  for (const task of tasks) counts.set(task.id, (counts.get(task.id) ?? 0) + 1)
  for (const [id, count] of counts) {
    if (count > 1) {
      diagnostics.push({
        severity: "error",
        code: "duplicate-id",
        message: `${count} tasks have ID ${id}`,
        taskId: id,
      })
    }
  }
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (dependency === task.id) {
        diagnostics.push({
          severity: "error",
          code: "self-dependency",
          message: `task ${task.id} depends on itself`,
          taskId: task.id,
        })
      } else if (!counts.has(dependency)) {
        diagnostics.push({
          severity: "error",
          code: "unknown-dependency",
          message: `task ${task.id} depends on unknown task ${dependency}`,
          taskId: task.id,
        })
      }
    }
  }
  // Self-dependencies are reported above, so they are left out of the cycle search.
  const edges = new Map(
    tasks.map((task) => [task.id, task.dependsOn.filter((id) => id !== task.id)] as const),
  )
  const cycle = findCycle(edges)
  const [first] = cycle ?? []
  if (cycle !== undefined && first !== undefined) {
    diagnostics.push({
      severity: "error",
      code: "dependency-cycle",
      message: `dependency cycle: ${cycle.join(" → ")}`,
      taskId: first,
    })
  }
  return diagnostics
}

/** The store's diagnostics, plus model diagnostics it has not already reported (same code and task). */
export const mergeDiagnostics = (
  store: ReadonlyArray<Diagnostic>,
  model: ReadonlyArray<Diagnostic>,
): ReadonlyArray<Diagnostic> => [
  ...store,
  ...model.filter((m) => !store.some((s) => s.code === m.code && s.taskId === m.taskId)),
]
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test test/core/check.test.ts`
Expected: `6 pass`, `0 fail`.

- [ ] **Step 5: Run the gate and commit**

```bash
bun run check
git add src/core/check.ts test/core/check.test.ts
git commit -m "Check a list against the model's rules in core" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014ak6bnNqeftYod6YDrWkcK"
```

---

### Task 3: TodoService

**Files:**
- Create: `src/core/errors.ts`, `src/core/TodoService.ts`
- Test: `test/core/TodoService.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2; from `spec`: `TodoStore`, `Unsupported`, `MemoryTodoStore` (tests) and the model and error types.
- Produces:
  - `class HasDependents` (`Schema.TaggedError` with `{ id, dependents }`).
  - `interface Listing { title; description; sections: SectionView[]; done: TaskView[] }`
  - `interface Dependency { id; title: string | undefined; state: TaskState | "unknown" }`
  - `interface TaskDetail { view; dependencies; blocks }`
  - `interface Completion { task; unblocked }`
  - `class TodoService`, a `Context.Service` with key `"@lemol/todo-md/core/TodoService"` and these members:
    - `capabilities`
    - `list(filter?)`, `next(filter?)`, `show(id)`, `check()`
    - `add`, `update`, `move`, `complete` (returns `Completion`), `reopen`
    - `remove(id, { force? })`, `renameGroup`, `comment`

    `static layer: Layer<TodoService, never, TodoStore>`.

- [ ] **Step 1: Write the failing test**

Create `test/core/TodoService.test.ts`:

```ts
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { TodoService } from "../../src/core/TodoService.ts"
import { MemoryTodoStore, TodoStore } from "../../src/spec/index.ts"
import { effectTest } from "../../src/spec/testing.ts"

const service = TodoService.layer.pipe(Layer.provideMerge(MemoryTodoStore.layer({ title: "Acme" })))

/** Adds tasks: 1 (ungrouped), 2 and 3 in Backend (3 depends on 2), 4 in Frontend (tagged, assigned). */
const seed = Effect.gen(function* () {
  const todo = yield* TodoService
  yield* todo.add({ title: "Write changelog" })
  yield* todo.add({ title: "Add rate limiting" }, { group: "Backend" })
  yield* todo.add({ title: "Load test", dependsOn: ["2"] }, { group: "Backend" })
  yield* todo.add({ title: "Fix layout", tags: ["bug"], assignee: "lemol" }, { group: "Frontend" })
  return todo
})

const ids = (views: ReadonlyArray<{ readonly task: { readonly id: string } }>) =>
  views.map((v) => v.task.id)

describe("TodoService queries", () => {
  effectTest(
    "list returns every section with its open tasks and their state",
    Effect.gen(function* () {
      const listing = yield* (yield* seed).list()
      expect(listing.title).toBe("Acme")
      expect(
        listing.sections.map((s) => [s.name, s.tasks.map((v) => [v.task.id, v.state])]),
      ).toEqual([
        [undefined, [["1", "ready"]]],
        [
          "Backend",
          [
            ["2", "ready"],
            ["3", "blocked"],
          ],
        ],
        ["Frontend", [["4", "ready"]]],
      ])
      expect(listing.done).toEqual([])
    }),
    service,
  )

  effectTest(
    "list filters by tag, assignee, group and state, keeping every section",
    Effect.gen(function* () {
      const todo = yield* seed
      const tasksOf = (listing: {
        readonly sections: ReadonlyArray<{
          readonly tasks: ReadonlyArray<{ readonly task: { readonly id: string } }>
        }>
      }) => listing.sections.flatMap((s) => ids(s.tasks))
      expect(tasksOf(yield* todo.list({ tags: ["bug"] }))).toEqual(["4"])
      expect(tasksOf(yield* todo.list({ assignee: "lemol" }))).toEqual(["4"])
      expect(tasksOf(yield* todo.list({ group: "Backend" }))).toEqual(["2", "3"])
      expect(tasksOf(yield* todo.list({ state: "blocked" }))).toEqual(["3"])
      expect((yield* todo.list({ tags: ["bug"] })).sections).toHaveLength(3)
    }),
    service,
  )

  effectTest(
    "list returns done tasks when asked, with or without open ones",
    Effect.gen(function* () {
      const todo = yield* seed
      yield* todo.complete("2")
      expect((yield* todo.list()).done).toEqual([])
      const done = yield* todo.list({ status: "done" })
      expect(done.sections).toEqual([])
      expect(done.done.map((v) => [v.task.id, v.state])).toEqual([["2", "done"]])
      const all = yield* todo.list({ status: "all" })
      expect(all.sections.flatMap((s) => ids(s.tasks))).toEqual(["1", "3", "4"])
      expect(ids(all.done)).toEqual(["2"])
    }),
    service,
  )

  effectTest(
    "next returns ready tasks in priority order, filtered",
    Effect.gen(function* () {
      const todo = yield* seed
      expect(ids(yield* todo.next())).toEqual(["1", "2", "4"])
      expect(ids(yield* todo.next({ group: "Frontend" }))).toEqual(["4"])
      yield* todo.complete("2")
      expect(ids(yield* todo.next())).toEqual(["1", "3", "4"])
    }),
    service,
  )

  effectTest(
    "show describes a task's dependencies and the tasks it blocks",
    Effect.gen(function* () {
      const todo = yield* seed
      const two = yield* todo.show("2")
      expect(two.view.state).toBe("ready")
      expect(two.dependencies).toEqual([])
      expect(ids(two.blocks)).toEqual(["3"])
      yield* todo.update("3", { dependsOn: ["2", "99"] })
      expect((yield* todo.show("3")).dependencies).toEqual([
        { id: "2", title: "Add rate limiting", state: "ready" },
        { id: "99", title: undefined, state: "unknown" },
      ])
      expect((yield* Effect.flip(todo.show("does-not-exist")))._tag).toBe("TaskNotFound")
    }),
    service,
  )

  effectTest(
    "check adds model problems to the store's diagnostics",
    Effect.gen(function* () {
      const todo = yield* seed
      expect(yield* todo.check()).toEqual([])
      yield* todo.update("1", { dependsOn: ["99"] })
      expect((yield* todo.check()).map((d) => [d.code, d.taskId])).toEqual([
        ["unknown-dependency", "1"],
      ])
    }),
    service,
  )
})

describe("TodoService mutations", () => {
  effectTest(
    "complete reports the open tasks it made ready",
    Effect.gen(function* () {
      const todo = yield* seed
      yield* todo.add({ title: "Release", dependsOn: ["2", "1"] })
      const completion = yield* todo.complete("2")
      expect(completion.task).toMatchObject({ id: "2", status: "done" })
      expect(ids(completion.unblocked)).toEqual(["3"])
      expect(ids((yield* todo.complete("1")).unblocked)).toEqual(["5"])
      expect(ids((yield* todo.complete("4")).unblocked)).toEqual([])
    }),
    service,
  )

  effectTest(
    "remove refuses while open tasks depend on the task, unless forced",
    Effect.gen(function* () {
      const todo = yield* seed
      const refused = yield* Effect.flip(todo.remove("2"))
      expect(refused).toMatchObject({ _tag: "HasDependents", id: "2", dependents: ["3"] })
      expect((yield* todo.show("2")).view.state).toBe("ready")
      yield* todo.remove("2", { force: true })
      expect((yield* Effect.flip(todo.show("2")))._tag).toBe("TaskNotFound")
      expect((yield* Effect.flip(todo.remove("does-not-exist")))._tag).toBe("TaskNotFound")
    }),
    service,
  )

  effectTest(
    "other mutations go to the store",
    Effect.gen(function* () {
      const todo = yield* seed
      yield* todo.update("1", { title: "Write the changelog" })
      yield* todo.move("1", { group: "Backend" })
      yield* todo.renameGroup("Backend", "Server")
      yield* todo.comment("1", { author: "lemol", body: "Started." })
      yield* todo.complete("4")
      yield* todo.reopen("4")
      const task = yield* (yield* TodoStore).get("1")
      expect(task).toMatchObject({ title: "Write the changelog", group: "Server" })
      expect(task.comments).toHaveLength(1)
      expect((yield* (yield* TodoStore).get("4")).status).toBe("open")
    }),
    service,
  )
})

// A store that supports nothing optional: core must refuse before calling it.
const limited = Layer.effect(
  TodoStore,
  Effect.gen(function* () {
    const store = yield* TodoStore
    return TodoStore.of({
      ...store,
      capabilities: { groups: false, reorder: false, renameGroup: false, comments: false },
    })
  }),
).pipe(Layer.provide(MemoryTodoStore.layer()))

describe("TodoService capability guards", () => {
  effectTest(
    "unsupported operations fail with Unsupported before reaching the store",
    Effect.gen(function* () {
      const todo = yield* TodoService
      const a = yield* todo.add({ title: "A" })
      const tags = (effect: Effect.Effect<unknown, { readonly _tag: string }>) =>
        Effect.map(Effect.flip(effect), (error) => error._tag)
      expect(yield* tags(todo.add({ title: "B" }, { group: "Backend" }))).toBe("Unsupported")
      expect(yield* tags(todo.add({ title: "B" }, { after: a.id }))).toBe("Unsupported")
      expect(yield* tags(todo.move(a.id, {}))).toBe("Unsupported")
      expect(yield* tags(todo.renameGroup("Backend", "Server"))).toBe("Unsupported")
      expect(yield* tags(todo.comment(a.id, { author: "lemol", body: "Hi." }))).toBe("Unsupported")
      expect((yield* (yield* TodoStore).load()).ungrouped.map((t) => t.id)).toEqual([a.id])
      expect((yield* (yield* TodoStore).get(a.id)).comments).toEqual([])
    }),
    TodoService.layer.pipe(Layer.provideMerge(limited)),
  )
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/core/TodoService.test.ts`
Expected: FAIL with `Cannot find module '../../src/core/TodoService.ts'`.

- [ ] **Step 3: Write the error**

Create `src/core/errors.ts`:

```ts
import { Schema } from "effect"

/** `remove` refused: open tasks still depend on the task. Pass `force` to remove it anyway. */
export class HasDependents extends Schema.TaggedError<HasDependents>()("HasDependents", {
  id: Schema.String,
  dependents: Schema.Array(Schema.String),
}) {}
```

- [ ] **Step 4: Write the service**

Create `src/core/TodoService.ts`:

```ts
import { Context, Effect, Layer } from "effect"
import {
  type Capabilities,
  type Comment,
  type CommentInput,
  type Diagnostic,
  type GroupNotFound,
  type InvalidTransition,
  type Placement,
  type StoreError,
  type Task,
  type TaskId,
  type TaskInput,
  type TaskNotFound,
  type TaskPatch,
  TodoStore,
  Unsupported,
  type ValidationError,
} from "../spec/index.ts"
import { mergeDiagnostics, modelDiagnostics } from "./check.ts"
import { HasDependents } from "./errors.ts"
import { matches, type TaskFilter } from "./filter.ts"
import {
  allTasks,
  boardOf,
  inPriorityOrder,
  type SectionView,
  type TaskState,
  type TaskView,
  view,
} from "./views.ts"

/** What `list` returns: the list's sections with their matching open tasks, and matching done tasks. */
export interface Listing {
  readonly title: string
  readonly description: string
  /** The ungrouped section first, then each group; empty when the filter asks only for done tasks. */
  readonly sections: ReadonlyArray<SectionView>
  /** Done tasks, most recently completed first; empty unless the filter asks for them. */
  readonly done: ReadonlyArray<TaskView>
}

export interface Dependency {
  readonly id: TaskId
  /** `undefined` when no task has this ID. */
  readonly title: string | undefined
  readonly state: TaskState | "unknown"
}

/** What `show` returns. */
export interface TaskDetail {
  readonly view: TaskView
  readonly dependencies: ReadonlyArray<Dependency>
  /** Open tasks that depend on this one. */
  readonly blocks: ReadonlyArray<TaskView>
}

/** What `complete` returns: the done task, and the open tasks it made ready. */
export interface Completion {
  readonly task: Task
  readonly unblocked: ReadonlyArray<TaskView>
}

/**
 * Adapter-agnostic todo.md logic over any `TodoStore`: queries with derived
 * state, validation, and guarded mutations. Frontends use this, not the store.
 */
export class TodoService extends Context.Service<
  TodoService,
  {
    readonly capabilities: Capabilities
    list(filter?: TaskFilter): Effect.Effect<Listing, StoreError>
    /** Ready open tasks in priority order: "what should I work on?" */
    next(filter?: TaskFilter): Effect.Effect<ReadonlyArray<TaskView>, StoreError>
    show(id: TaskId): Effect.Effect<TaskDetail, TaskNotFound | StoreError>
    /** The store's diagnostics plus the model checks of spec §1.6. */
    check(): Effect.Effect<ReadonlyArray<Diagnostic>, StoreError>
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
    complete(id: TaskId): Effect.Effect<Completion, TaskNotFound | InvalidTransition | StoreError>
    reopen(id: TaskId): Effect.Effect<Task, TaskNotFound | InvalidTransition | StoreError>
    /** Refuses with `HasDependents` while open tasks depend on the task, unless `force`. */
    remove(
      id: TaskId,
      options?: { readonly force?: boolean },
    ): Effect.Effect<void, TaskNotFound | HasDependents | StoreError>
    renameGroup(
      from: string,
      to: string,
    ): Effect.Effect<void, GroupNotFound | ValidationError | Unsupported | StoreError>
    comment(
      id: TaskId,
      input: CommentInput,
    ): Effect.Effect<Comment, TaskNotFound | ValidationError | Unsupported | StoreError>
  }
>()("@lemol/todo-md/core/TodoService") {
  static readonly layer: Layer.Layer<TodoService, never, TodoStore> = Layer.effect(
    TodoService,
    Effect.gen(function* () {
      const store = yield* TodoStore
      const board = Effect.map(Effect.all([store.load(), store.listDone()]), ([list, done]) =>
        boardOf(list, done),
      )

      /** Fails early when the store lacks a capability (spec §1.5). */
      const requires = (capability: keyof Capabilities, operation: string) =>
        store.capabilities[capability] ? Effect.void : Effect.fail(new Unsupported({ operation }))

      const placementNeeds = (placement: Placement, operation: string) =>
        Effect.all([
          placement.group === undefined ? Effect.void : requires("groups", operation),
          placement.before === undefined && placement.after === undefined
            ? Effect.void
            : requires("reorder", operation),
        ])

      return TodoService.of({
        capabilities: store.capabilities,

        list: (filter = {}) =>
          Effect.map(board, (b) => {
            const keep = matches(filter)
            const status = filter.status ?? "open"
            const sections = [
              { name: undefined, description: b.list.description, tasks: b.list.ungrouped },
              ...b.list.groups,
            ].map((section) => ({
              name: section.name,
              description: section.description,
              tasks: section.tasks.map(view(b)).filter(keep),
            }))
            return {
              title: b.list.title,
              description: b.list.description,
              sections: status === "done" ? [] : sections,
              done: status === "open" ? [] : b.done.map(view(b)).filter(keep),
            }
          }),

        next: (filter = {}) =>
          Effect.map(board, (b) =>
            inPriorityOrder(b.list)
              .map(view(b))
              .filter((v) => v.state === "ready" && matches(filter)(v)),
          ),

        show: (id) =>
          Effect.gen(function* () {
            const task = yield* store.get(id)
            const b = yield* board
            const byId = new Map(allTasks(b).map((t) => [t.id, t] as const))
            return {
              view: view(b)(task),
              dependencies: task.dependsOn.map((dependency) => {
                const found = byId.get(dependency)
                return {
                  id: dependency,
                  title: found?.title,
                  state: found === undefined ? ("unknown" as const) : view(b)(found).state,
                }
              }),
              blocks: inPriorityOrder(b.list)
                .filter((t) => t.dependsOn.includes(id))
                .map(view(b)),
            }
          }),

        check: () =>
          Effect.gen(function* () {
            const [diagnostics, b] = yield* Effect.all([store.diagnostics(), board])
            return mergeDiagnostics(diagnostics, modelDiagnostics(allTasks(b)))
          }),

        add: (input, placement = {}) =>
          placementNeeds(placement, "add").pipe(Effect.andThen(store.add(input, placement))),

        update: (id, patch) => store.update(id, patch),

        move: (id, placement) =>
          requires("reorder", "move").pipe(
            Effect.andThen(placementNeeds(placement, "move")),
            Effect.andThen(store.move(id, placement)),
          ),

        complete: (id) =>
          Effect.gen(function* () {
            const task = yield* store.complete(id)
            const b = yield* board
            const unblocked = inPriorityOrder(b.list)
              .filter((t) => t.dependsOn.includes(id))
              .map(view(b))
              .filter((v) => v.state === "ready")
            return { task, unblocked }
          }),

        reopen: (id) => store.reopen(id),

        remove: (id, options = {}) =>
          Effect.gen(function* () {
            yield* store.get(id)
            if (options.force !== true) {
              const dependents = inPriorityOrder((yield* board).list)
                .filter((t) => t.dependsOn.includes(id))
                .map((t) => t.id)
              if (dependents.length > 0) return yield* new HasDependents({ id, dependents })
            }
            yield* store.remove(id)
          }),

        renameGroup: (from, to) =>
          requires("renameGroup", "renameGroup").pipe(Effect.andThen(store.renameGroup(from, to))),

        comment: (id, input) =>
          requires("comments", "comment").pipe(Effect.andThen(store.comment(id, input))),
      })
    }),
  )
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test test/core/TodoService.test.ts`
Expected: `10 pass`, `0 fail`.

- [ ] **Step 6: Run the gate and commit**

```bash
bun run check
git add src/core/errors.ts src/core/TodoService.ts test/core/TodoService.test.ts
git commit -m "Add TodoService: queries, checks and guarded mutations over any store" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014ak6bnNqeftYod6YDrWkcK"
```

---

### Task 4: Public entry point and docs

**Files:**
- Modify: `src/core/index.ts` (replace the placeholder), `src/core/README.md`, `docs/architecture.md`
- Test: `test/core/index.test.ts`

**Interfaces:**
- Consumes: every module above.
- Produces: `@lemol/todo-md/core`, re-exporting `check`, `errors`, `filter`, `TodoService` and `views`. This is the surface Plan 5 (`cli`) imports.

- [ ] **Step 1: Write the failing test**

Create `test/core/index.test.ts`:

```ts
import { expect, test } from "bun:test"
import * as core from "../../src/core/index.ts"

test("the public entry point exposes the service, its error and the pure helpers", () => {
  expect(core.TodoService.key).toBe("@lemol/todo-md/core/TodoService")
  for (const name of [
    "HasDependents",
    "viewOf",
    "boardOf",
    "inPriorityOrder",
    "matches",
    "modelDiagnostics",
    "mergeDiagnostics",
  ]) {
    expect(core).toHaveProperty(name)
  }
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/core/index.test.ts`
Expected: FAIL with `TypeError: undefined is not an object (evaluating 'core.TodoService.key')`.

- [ ] **Step 3: Write the entry point**

Replace the contents of `src/core/index.ts` with:

```ts
export * from "./check.ts"
export * from "./errors.ts"
export * from "./filter.ts"
export * from "./TodoService.ts"
export * from "./views.ts"
```

Run: `bun test test/core/index.test.ts`
Expected: `1 pass`, `0 fail`.

- [ ] **Step 4: Update the docs**

Replace `src/core/README.md` with:

````markdown
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
````

In `docs/architecture.md`, in the `## core` section, replace the whole bullet list between the paragraph "`TodoService` is a layer that requires a `TodoStore` and provides:" and the paragraph beginning "`core` knows nothing about Markdown" with:

```markdown
- **Queries with derived state:** every task comes back with its state
  (`ready`, `blocked`, `done`) and what it is blocked by.
  - `list(filter)` filters by tag, assignee, group, state and status.
  - `next()` returns the ready tasks in priority order (spec §1.3).
  - `show(id)` returns a task with its dependencies and the tasks it blocks.
- **`check()`:** model validation (`duplicate-id`, `unknown-dependency`,
  `self-dependency`, `dependency-cycle`) merged with the store's
  `diagnostics()`, without reporting the same problem twice.
- **Guarded mutations:**
  - `remove` refuses when open tasks depend on the task, unless forced.
  - Operations the store's capabilities don't include fail early with
    `Unsupported`, before the store is called.
  - `complete` also reports the tasks it made ready.
  - Rejecting new cycles is left to the stores, which must do it
    (spec §1.6).
```

- [ ] **Step 5: Run the gate and commit**

Run: `bun run check`
Expected: lint and typecheck clean; `307 pass`, `0 fail` (276 before this plan + 31 core).

```bash
git add src/core/index.ts src/core/README.md docs/architecture.md test/core/index.test.ts
git commit -m "Expose the core module" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014ak6bnNqeftYod6YDrWkcK"
```
