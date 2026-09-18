# Cancelling a task Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a task leave the list as abandoned rather than completed, recording why, without pretending the work was done.

**Architecture:** `status` stays `open | done`. A done task gains an `outcome` of `completed` or `cancelled`, plus a `cancelledReason`. Absent `outcome` means `completed`, so every existing done file reads correctly with no migration. Cancelled does **not** satisfy a dependency — that is one clause of spec §1.3 and one line of `src/core/views.ts`, plus a `cancelled-dependency` warning. `cancel` is a capability, not a required operation.

**Tech Stack:** Bun, Effect 4 (`effect` is an exact peer dependency — do not change its version), `bun:test`, Biome, Remix 3 for `src/web`.

**Spec:** [`docs/superpowers/specs/2026-09-18-cancelling-a-task-design.md`](../specs/2026-09-18-cancelling-a-task-design.md)

## Global Constraints

- **`docs/spec.md` is the source of truth.** Each task below updates the spec sections it implements *in the same commit* as the code. Never let them drift.
- **Module graph.** `test/boundaries.test.ts` enforces it. Modules import each other through relative paths, never through `@lemol/todo-md/...`. This feature adds no new cross-module imports; if you think you need one, stop and reconsider.
- **Minimal diffs.** Writers splice text, never re-serialize a whole Markdown file (spec §2.10).
- **Conformance.** Every `TodoStore` implementation must pass `runConformance`.
- **Tests** use `bun:test` plus the `effectTest` helper from `src/spec/testing.ts`.
- **CLI help.** Every command needs a description, a description for each flag and argument, and examples. `test/cli/help.test.ts` checks every command.
- **The gate for every change:** `bun run check` (lint + typecheck + tests). Run it before every commit.
- **Before writing any Effect code**, read `node_modules/effect/AGENTS.md` completely.

**Naming, fixed across all tasks.** Later tasks depend on these exact names:

| Thing | Name |
| ----- | ---- |
| Schema literal | `TaskOutcome = Schema.Literals(["completed", "cancelled"])` |
| Task fields | `outcome?: TaskOutcome`, `cancelledReason?: string` |
| Capability | `cancel: boolean` |
| Store method | `cancel(id: TaskId, reason: string)` |
| Board field (renamed) | `satisfiedIds` (was `doneIds`) |
| Diagnostic code | `cancelled-dependency` |
| Frontmatter keys | `outcome`, `cancelled_reason` |
| CLI command | `todo cancel <id> --reason <text>` |

---

### Task 1: Model and capability

Adds the two fields and the capability flag. Nothing uses them yet; this is the vocabulary every later task speaks.

**Files:**
- Modify: `src/spec/model.ts:18-43`
- Modify: `src/spec/TodoStore.ts:22-37`
- Modify: `docs/spec.md` §1.1, §1.5
- Modify: `test/core/fixtures.ts`
- Test: `test/spec/model.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TaskOutcome` (Schema + type) from `src/spec/model.ts`; `Task.outcome?: "completed" | "cancelled"`; `Task.cancelledReason?: string`; `Capabilities.cancel: boolean`; `allCapabilities.cancel === true`.

- [ ] **Step 1: Write the failing test**

Append to `test/spec/model.test.ts`, and add `Task` to the existing import from `../../src/spec/model.ts`:

```ts
describe("Task outcome", () => {
  const base = {
    id: "1",
    title: "Ship it",
    description: "",
    status: "done",
    tags: [],
    dependsOn: [],
    comments: [],
    extra: {},
  }

  test("a done task may be completed or cancelled", () => {
    accepts(Task, { ...base, outcome: "completed" })
    accepts(Task, { ...base, outcome: "cancelled", cancelledReason: "Superseded." })
  })

  test("an absent outcome is valid, and means completed", () => {
    accepts(Task, base)
  })

  test("rejects an outcome the model does not define", () => {
    rejects(Task, { ...base, outcome: "wontfix" })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/spec/model.test.ts`
Expected: FAIL — `rejects(Task, { outcome: "wontfix" })` gets `true` because `outcome` is currently an unknown key, and the import of `Task` may not resolve.

- [ ] **Step 3: Add the schema**

In `src/spec/model.ts`, after the `TaskStatus` declaration (line 18-19):

```ts
/** How a done task ended (spec §1.1). Absent on a done task means "completed". */
export const TaskOutcome = Schema.Literals(["completed", "cancelled"])
export type TaskOutcome = typeof TaskOutcome.Type
```

In the `Task` struct, add `outcome` directly after `status`, and `cancelledReason` directly after `completedAt`:

```ts
  status: TaskStatus,
  outcome: Schema.optional(TaskOutcome),
  …
  completedAt: Schema.optional(Schema.DateTimeUtc),
  cancelledReason: Schema.optional(Schema.String),
```

- [ ] **Step 4: Add the capability**

In `src/spec/TodoStore.ts`, add `cancel: Schema.Boolean,` to the `Capabilities` struct after `promote`, and `cancel: true,` to `allCapabilities`.

- [ ] **Step 5: Keep the core fixture total**

`test/core/fixtures.ts` builds a complete `Task`. Add both fields so it stays exhaustive:

```ts
  completedAt: undefined,
  outcome: undefined,
  cancelledReason: undefined,
  extra: {},
```

- [ ] **Step 6: Update the spec**

In `docs/spec.md` §1.1, add two rows to the Task table after `completedAt`:

```markdown
| `outcome`     | `completed` \| `cancelled` | Done tasks only. Absent on a done task means `completed`. |
| `cancelledReason` | string?          | Why the task was abandoned. Set by `cancel`. MAY be absent on a task cancelled by hand and not yet normalized. |
```

In §1.5, add a row to the capability table:

```markdown
| `cancel`      | `cancel` fails with `Unsupported`; no task has outcome `cancelled`.                   |
```

- [ ] **Step 7: Run the gate**

Run: `bun run check`
Expected: PASS. `MemoryTodoStore.test.ts` compares `store.capabilities` to `{ ...allCapabilities, promote: false }`, so it picks up `cancel: true` automatically.

- [ ] **Step 8: Commit**

```bash
git add src/spec/model.ts src/spec/TodoStore.ts docs/spec.md test/spec/model.test.ts test/core/fixtures.ts
git commit -m "Add a task outcome and the cancel capability"
```

---

### Task 2: The `cancel` operation on the contract and MemoryTodoStore

**Files:**
- Modify: `src/spec/TodoStore.ts` (the service interface, beside `complete`)
- Modify: `src/spec/MemoryTodoStore.ts:183` (capabilities), `:270-279` (beside `complete`), `:280-300` (reopen)
- Modify: `docs/spec.md` §1.4
- Modify: `src/spec/README.md`
- Test: `test/spec/MemoryTodoStore.test.ts`

**Interfaces:**
- Consumes: `TaskOutcome`, `Capabilities.cancel` (Task 1).
- Produces: `TodoStore.cancel(id: TaskId, reason: string): Effect.Effect<Task, TaskNotFound | InvalidTransition | ValidationError | Unsupported | StoreError>`. `MemoryTodoStore.layer()` declares `cancel: true`. `reopen` clears `outcome` and `cancelledReason`.

- [ ] **Step 1: Write the failing test**

Append to the `describe("MemoryTodoStore", …)` block in `test/spec/MemoryTodoStore.test.ts`:

```ts
  effectTest(
    "cancel records the outcome and the reason, and reopen clears both",
    Effect.gen(function* () {
      const store = yield* TodoStore
      const task = yield* store.add({ title: "Register apps/* in the workspace" })
      const cancelled = yield* store.cancel(task.id, "Superseded: there is no apps/ directory.")
      expect(cancelled.status).toBe("done")
      expect(cancelled.outcome).toBe("cancelled")
      expect(cancelled.cancelledReason).toBe("Superseded: there is no apps/ directory.")
      expect(cancelled.completedAt).toBeDefined()

      const reopened = yield* store.reopen(task.id)
      expect(reopened.status).toBe("open")
      expect(reopened.outcome).toBeUndefined()
      expect(reopened.cancelledReason).toBeUndefined()
      expect(reopened.completedAt).toBeUndefined()
    }),
    MemoryTodoStore.layer(),
  )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/spec/MemoryTodoStore.test.ts`
Expected: FAIL — `store.cancel is not a function`, and a typecheck error that `cancel` is not on `TodoStore`.

- [ ] **Step 3: Add `cancel` to the contract**

In `src/spec/TodoStore.ts`, directly after the `complete` line in the service interface:

```ts
    /** Abandons an open task: it becomes done with outcome `cancelled` (spec §1.4). */
    cancel(
      id: TaskId,
      reason: string,
    ): Effect.Effect<
      Task,
      TaskNotFound | InvalidTransition | ValidationError | Unsupported | StoreError
    >
```

- [ ] **Step 4: Implement it in MemoryTodoStore**

Change the capability line at `src/spec/MemoryTodoStore.ts:183` to keep `cancel` on:

```ts
        capabilities: { ...allCapabilities, promote: false },
```

(unchanged — `allCapabilities.cancel` is already `true` from Task 1).

Add `cancel` directly after `complete`, mirroring it:

```ts
        cancel: (id, reason) =>
          transact((state) =>
            Effect.gen(function* () {
              if (reason.trim() === "") {
                return yield* new ValidationError({
                  issues: [`cancelling task ${id} needs a reason`],
                })
              }
              const { task } = yield* findOpen(state, id, "cancel")
              const cancelled: Task = {
                ...task,
                status: "done",
                outcome: "cancelled",
                cancelledReason: reason,
                completedAt: yield* DateTime.now,
              }
              const rest = withoutTask(state, id)
              return [cancelled, { ...rest, done: [cancelled, ...rest.done] }] as const
            }),
          ),
```

In `complete`, set the outcome explicitly so the two are symmetric:

```ts
              const done: Task = {
                ...task,
                status: "done",
                outcome: "completed",
                completedAt: yield* DateTime.now,
              }
```

In `reopen`, clear both new fields alongside `completedAt`:

```ts
              const reopened: Task = {
                ...task,
                status: "open",
                outcome: undefined,
                cancelledReason: undefined,
                completedAt: undefined,
                group,
              }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test test/spec/MemoryTodoStore.test.ts`
Expected: PASS.

- [ ] **Step 6: Update the spec and the module README**

In `docs/spec.md` §1.4, add a row after `complete`:

```markdown
| `cancel(id, reason)`       | open → done with outcome `cancelled`. Sets `completedAt` to now, records `group` and `cancelledReason`. Cancelling a blocked task MUST be allowed. | `TaskNotFound`, `InvalidTransition`, `ValidationError`, `Unsupported` |
```

Amend the `reopen` row to say it clears `outcome` and `cancelledReason` as well as `completedAt`, and the `complete` row to say it sets `outcome` to `completed`.

Update `src/spec/README.md` wherever it lists the operations, adding `cancel`.

- [ ] **Step 7: Run the gate and commit**

```bash
bun run check
git add src/spec docs/spec.md test/spec
git commit -m "Add cancel to the store contract and MemoryTodoStore"
```

---

### Task 3: Conformance cases

Makes `cancel` a statement of the spec that every store must satisfy, gated on the capability.

**Files:**
- Create: `src/spec/testing/conformance/cancelling.ts`
- Modify: `src/spec/testing/conformance/index.ts:1-25`
- Modify: `src/spec/MemoryTodoStore.ts` (a `cancel: false` variant, to exercise the absent path)

**Interfaces:**
- Consumes: `TodoStore.cancel` (Task 2), `ConformanceCase` from `./case.ts`, `equal`/`failsWith` from `./assert.ts`.
- Produces: `cancellingCases: ReadonlyArray<ConformanceCase>`.

- [ ] **Step 1: Write the failing test**

Create `src/spec/testing/conformance/cancelling.ts`, following `promotion.ts`:

```ts
import { Effect } from "effect"
import { TodoStore } from "../../TodoStore.ts"
import { equal, failsWith } from "./assert.ts"
import type { ConformanceCase } from "./case.ts"

/**
 * Cancelling is how a task leaves the list without claiming it was finished.
 * It is a done task with an outcome, so everything that holds for done tasks
 * holds here too; what is specific is the outcome, the reason, and that a
 * cancelled task does not satisfy a dependency.
 */
export const cancellingCases: ReadonlyArray<ConformanceCase> = [
  {
    name: "cancel makes the task done with outcome cancelled",
    requires: ["cancel"],
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const task = yield* store.add({ title: "Register apps/* in the workspace" })
      const cancelled = yield* store.cancel(task.id, "Superseded: there is no apps/ directory.")
      equal(cancelled.status, "done")
      equal(cancelled.outcome, "cancelled")
      equal(cancelled.cancelledReason, "Superseded: there is no apps/ directory.")
      equal(yield* store.get(task.id), cancelled)
    }),
  },
  {
    name: "a cancelled task is listed among the done tasks",
    requires: ["cancel"],
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const task = yield* store.add({ title: "Drop this" })
      yield* store.cancel(task.id, "Not needed.")
      const done = yield* store.listDone()
      equal(done.map((t) => t.id), [task.id])
      const list = yield* store.load()
      equal(list.ungrouped.length, 0)
    }),
  },
  {
    name: "cancel rejects an empty reason",
    requires: ["cancel"],
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const task = yield* store.add({ title: "Keep this" })
      yield* failsWith(store.cancel(task.id, "   "), "ValidationError")
      equal((yield* store.get(task.id)).status, "open")
    }),
  },
  {
    name: "cancel is allowed on a blocked task",
    requires: ["cancel"],
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const blocker = yield* store.add({ title: "First" })
      const blocked = yield* store.add({ title: "Second", dependsOn: [blocker.id] })
      const cancelled = yield* store.cancel(blocked.id, "Changed our minds.")
      equal(cancelled.outcome, "cancelled")
    }),
  },
  {
    name: "cancel rejects a task that is already done",
    requires: ["cancel"],
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const task = yield* store.add({ title: "Ship it" })
      yield* store.complete(task.id)
      yield* failsWith(store.cancel(task.id, "Too late."), "InvalidTransition")
    }),
  },
  {
    name: "cancel rejects an unknown task",
    requires: ["cancel"],
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      yield* failsWith(store.cancel("does-not-exist", "Gone."), "TaskNotFound")
    }),
  },
  {
    name: "reopen clears the outcome and the reason",
    requires: ["cancel"],
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const task = yield* store.add({ title: "Bring it back" })
      yield* store.cancel(task.id, "Dropped.")
      const reopened = yield* store.reopen(task.id)
      equal(reopened.status, "open")
      equal(reopened.outcome, undefined)
      equal(reopened.cancelledReason, undefined)
    }),
  },
  {
    name: "complete records the completed outcome",
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const task = yield* store.add({ title: "Ship it" })
      equal((yield* store.complete(task.id)).outcome, "completed")
    }),
  },
  {
    name: "cancel fails with Unsupported when the store cannot cancel",
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      if (store.capabilities.cancel) return
      const task = yield* store.add({ title: "Task" })
      yield* failsWith(store.cancel(task.id, "Dropped."), "Unsupported")
    }),
  },
]
```

- [ ] **Step 2: Wire the cases in**

In `src/spec/testing/conformance/index.ts`, add the import `import { cancellingCases } from "./cancelling.ts"` and `...cancellingCases,` to `conformanceCases`, after `...lifecycleCases,`.

- [ ] **Step 3: Run to verify it passes for MemoryTodoStore**

Run: `bun test test/spec/MemoryTodoStore.test.ts`
Expected: PASS — MemoryTodoStore has the capability and Task 2 implemented it. The `Unsupported` case returns early for this store.

- [ ] **Step 4: Verify the absent path is actually covered**

`MemoryTodoStore.layer()` declares `cancel: true`, so the Unsupported case never runs. Add an option so the absent path is exercised. In `src/spec/MemoryTodoStore.ts`, where the layer takes its options, thread a `cancel?: boolean` through to:

```ts
        capabilities: { ...allCapabilities, promote: false, cancel: options?.cancel ?? true },
```

and in `src/spec/MemoryTodoStore.ts`, make `cancel` fail when the capability is off:

```ts
        cancel: (id, reason) =>
          options?.cancel === false
            ? new Unsupported({ operation: "cancel" })
            : transact(…)
```

Then register a second conformance run in `test/spec/MemoryTodoStore.test.ts`:

```ts
runConformance("MemoryTodoStore without cancel", MemoryTodoStore.layer({ cancel: false }))
```

- [ ] **Step 5: Run to verify both runs pass**

Run: `bun test test/spec/MemoryTodoStore.test.ts`
Expected: PASS. The second run skips the eight `requires: ["cancel"]` cases and exercises the `Unsupported` one.

- [ ] **Step 6: Run the gate and commit**

```bash
bun run check
git add src/spec test/spec
git commit -m "Add conformance cases for cancelling"
```

---

### Task 4: A cancelled task does not satisfy a dependency

The whole dependency semantic, in one place.

**Files:**
- Modify: `src/core/views.ts:21-56`
- Modify: `docs/spec.md` §1.3
- Test: `test/core/views.test.ts`

**Interfaces:**
- Consumes: `Task.outcome` (Task 1).
- Produces: `Board.satisfiedIds` (renamed from `doneIds`); `viewOf(task, satisfiedIds)`.

- [ ] **Step 1: Write the failing test**

In `test/core/views.test.ts`, add to the `describe("boards", …)` block:

```ts
  test("a cancelled task does not satisfy a dependency on it", () => {
    const board = boardOf(
      { title: "T", description: "", ungrouped: [task({ id: "6", dependsOn: ["5"] })], groups: [] },
      [task({ id: "5", status: "done", outcome: "cancelled", cancelledReason: "Dropped." })],
    )
    expect(board.satisfiedIds).toEqual(new Set())
    expect(view(board)(task({ id: "6", dependsOn: ["5"] }))).toMatchObject({
      state: "blocked",
      blockedBy: ["5"],
    })
  })

  test("a completed task does satisfy it, with or without an explicit outcome", () => {
    const board = boardOf({ title: "T", description: "", ungrouped: [], groups: [] }, [
      task({ id: "7", status: "done", outcome: "completed" }),
      task({ id: "8", status: "done" }),
    ])
    expect(board.satisfiedIds).toEqual(new Set(["7", "8"]))
  })
```

Add `view` to the import from `../../src/core/views.ts`, and update the existing assertion at line 48 from `board.doneIds` to `board.satisfiedIds`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/core/views.test.ts`
Expected: FAIL — `board.satisfiedIds` is `undefined`, and the cancelled task is currently in `doneIds`.

- [ ] **Step 3: Rename the set and filter it**

In `src/core/views.ts`, rename the parameter, field and argument (6 sites, all inside this file), and filter on the outcome:

```ts
/** The derived state of `task`, given the IDs of all tasks that satisfy a dependency. */
export const viewOf = (task: Task, satisfiedIds: ReadonlySet<TaskId>): TaskView => {
  if (task.status === "done") return { task, state: "done", blockedBy: [] }
  const blockedBy = task.dependsOn.filter((id) => !satisfiedIds.has(id))
  return { task, state: blockedBy.length === 0 ? "ready" : "blocked", blockedBy }
}
```

```ts
export interface Board {
  readonly list: TodoList
  readonly done: ReadonlyArray<Task>
  /**
   * The IDs that satisfy a dependency (spec §1.3): done tasks whose outcome is
   * `completed`. A cancelled task is done but never arrived, so depending on
   * one stays blocked — `core/check.ts` reports it.
   */
  readonly satisfiedIds: ReadonlySet<TaskId>
}

export const boardOf = (list: TodoList, done: ReadonlyArray<Task>): Board => ({
  list,
  done,
  satisfiedIds: new Set(
    done.filter((task) => task.outcome !== "cancelled").map((task) => task.id),
  ),
})
```

and in `view`, pass `board.satisfiedIds`.

Also update the `blockedBy` doc comment on `TaskView` (line 10): "Dependencies that are not satisfied yet, including cancelled and unknown IDs; empty unless blocked."

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/core/views.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the spec**

In `docs/spec.md` §1.3, change the first bullet to:

```markdown
- A dependency is **satisfied** when it refers to a task that is done with
  outcome `completed`. A dependency on a cancelled task is unsatisfied, and it
  is also reported as a diagnostic (§1.6).
```

- [ ] **Step 6: Run the gate and commit**

```bash
bun run check
git add src/core/views.ts docs/spec.md test/core/views.test.ts
git commit -m "Stop a cancelled task satisfying a dependency"
```

---

### Task 5: The `cancelled-dependency` diagnostic

**Files:**
- Modify: `src/core/check.ts:20-38`
- Modify: `src/core/README.md:18`
- Modify: `docs/spec.md` §1.6
- Test: `test/core/check.test.ts`

**Interfaces:**
- Consumes: `Task.outcome` (Task 1).
- Produces: a `Diagnostic` with `code: "cancelled-dependency"`, `severity: "warning"`.

- [ ] **Step 1: Write the failing test**

In `test/core/check.test.ts`, matching the existing `codes(…)` idiom:

```ts
  test("a dependency on a cancelled task is a warning, not an error", () => {
    const tasks = [
      task({ id: "1", status: "done", outcome: "cancelled", cancelledReason: "Dropped." }),
      task({ id: "2", dependsOn: ["1"] }),
    ]
    expect(modelDiagnostics(tasks)).toEqual([
      {
        severity: "warning",
        code: "cancelled-dependency",
        message: "task 2 depends on cancelled task 1",
        taskId: "2",
      },
    ])
  })

  test("a dependency on a completed task is not reported", () => {
    const tasks = [
      task({ id: "1", status: "done", outcome: "completed" }),
      task({ id: "2", dependsOn: ["1"] }),
    ]
    expect(modelDiagnostics(tasks)).toEqual([])
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/core/check.test.ts`
Expected: FAIL — `modelDiagnostics` returns `[]` for the first case.

- [ ] **Step 3: Implement it**

In `src/core/check.ts`, build a lookup beside `counts` before the dependency loop:

```ts
  const cancelled = new Set(
    tasks.filter((task) => task.outcome === "cancelled").map((task) => task.id),
  )
```

and add a branch to the existing `for (const dependency of task.dependsOn)` chain, after the `unknown-dependency` branch:

```ts
      } else if (cancelled.has(dependency)) {
        diagnostics.push({
          severity: "warning",
          code: "cancelled-dependency",
          message: `task ${task.id} depends on cancelled task ${dependency}`,
          taskId: task.id,
        })
      }
```

Note the order: `unknown-dependency` is checked first, so a dependency that is both unknown and cancelled is impossible by construction (a cancelled task is in `counts`).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/core/check.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the spec and the module README**

In `docs/spec.md` §1.6, add to the diagnostics table:

```markdown
| `cancelled-dependency` | warning  | `dependsOn` refers to a cancelled task.          |
```

Below the table, add a sentence: "A dependency on a cancelled task is a warning, not an error: cancelling upstream work is a decision for its dependents, not a broken list. `add` and `update` MUST NOT reject it."

In `src/core/README.md:18`, add `cancelled-dependency` to the list of model checks `check()` performs.

- [ ] **Step 6: Run the gate and commit**

```bash
bun run check
git add src/core docs/spec.md test/core/check.test.ts
git commit -m "Warn when a task depends on a cancelled task"
```

---

### Task 6: Frontmatter round-trip

**Files:**
- Modify: `src/markdown/taskFile.ts:18-29` (content type, `standardKeys`), `:109-150` (parse), `:165-176` (`entries`), `:193-240` (`updateTaskFile`)
- Modify: `src/markdown/convert.ts:12-18`, `:45`, `:73-83`
- Modify: `docs/spec.md` §2.5, §2.6
- Test: `test/markdown/taskFile.test.ts`, `test/markdown/convert.test.ts`

**Interfaces:**
- Consumes: `TaskOutcome` (Task 1).
- Produces: `TaskFileContent.outcome?: TaskOutcome`, `TaskFileContent.cancelledReason?: string`; `updateTaskFile` accepts `outcome?: TaskOutcome | null` and `cancelledReason?: string | null`.

- [ ] **Step 1: Write the failing test**

In `test/markdown/taskFile.test.ts`:

```ts
  test("reads a cancelled task's outcome and reason", () => {
    const file = parseTaskFile(
      ["---", "title: Drop this", "completed_at: 2026-09-18T19:13:18Z", "outcome: cancelled", "cancelled_reason: Superseded by d47fcd2.", "---", ""].join("\n"),
    )
    expect(file.outcome).toBe("cancelled")
    expect(file.cancelledReason).toBe("Superseded by d47fcd2.")
    expect(file.extra).toEqual({})
    expect(file.diagnostics).toEqual([])
  })

  test("an outcome the model does not define is invalid frontmatter", () => {
    const file = parseTaskFile(
      ["---", "title: T", "completed_at: 2026-09-18T19:13:18Z", "outcome: wontfix", "---", ""].join("\n"),
    )
    expect(file.outcome).toBeUndefined()
    expect(file.diagnostics.map((d) => d.code)).toEqual(["invalid-frontmatter"])
  })

  test("writes the outcome and reason after completed_at", () => {
    const source = formatTaskFile({
      title: "Drop this",
      tags: [],
      assignee: undefined,
      dependsOn: [],
      extra: {},
      description: "",
      comments: [],
      group: undefined,
      completedAt: DateTime.unsafeMake("2026-09-18T19:13:18Z"),
      outcome: "cancelled",
      cancelledReason: "Superseded by d47fcd2.",
    })
    expect(source).toContain("completed_at: 2026-09-18T19:13:18Z")
    expect(source).toContain("outcome: cancelled")
    expect(source).toContain("cancelled_reason: Superseded by d47fcd2.")
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/markdown/taskFile.test.ts`
Expected: FAIL — `outcome` lands in `extra`, and `formatTaskFile` rejects the two unknown properties at typecheck.

- [ ] **Step 3: Extend the content type and the standard keys**

In `src/markdown/taskFile.ts`, in `TaskFileContent` after `completedAt`:

```ts
  /** Done files only. Absent means `completed` (spec §1.1). */
  readonly outcome: "completed" | "cancelled" | undefined
  /** Cancelled files only. */
  readonly cancelledReason: string | undefined
```

and extend `standardKeys` (line 29) so neither key falls through to `extra`:

```ts
const standardKeys = new Set([
  "title",
  "tags",
  "assignee",
  "depends_on",
  "completed_at",
  "group",
  "outcome",
  "cancelled_reason",
])
```

- [ ] **Step 4: Parse them**

Beside the `completedAt` parse (line 109-113):

```ts
  const outcomeText = stringField("outcome")
  const outcome =
    outcomeText === "completed" || outcomeText === "cancelled" ? outcomeText : undefined
  if (outcomeText !== undefined && outcome === undefined)
    invalid("outcome", "`completed` or `cancelled`")
```

and add both to the returned object, after `completedAt`:

```ts
    outcome,
    cancelledReason: stringField("cancelled_reason"),
```

- [ ] **Step 5: Write them**

In `entries` (line 165-176), after the `completed_at` entry — canonical order puts them last:

```ts
  ...(content.outcome === undefined ? [] : [["outcome", content.outcome] as const]),
  ...(content.cancelledReason === undefined
    ? []
    : [["cancelled_reason", content.cancelledReason] as const]),
```

In the `updateTaskFile` changes type (line 203) add:

```ts
  readonly outcome?: "completed" | "cancelled" | null
  readonly cancelledReason?: string | null
```

and beside the `completedAt` handling at line 232:

```ts
  if (changes.outcome !== undefined) {
    fields.outcome = changes.outcome === null ? undefined : changes.outcome
  }
  if (changes.cancelledReason !== undefined) {
    fields.cancelled_reason = changes.cancelledReason === null ? undefined : changes.cancelledReason
  }
```

- [ ] **Step 6: Carry them through `convert.ts`**

At line 18 (the inline-task branch) add `outcome: undefined, cancelledReason: undefined,`. At line 45 (from a task file) add `outcome: file.outcome, cancelledReason: file.cancelledReason,`. At line 83, beside the existing done-only fields:

```ts
  outcome: task.status === "done" ? task.outcome : undefined,
  cancelledReason: task.status === "done" ? task.cancelledReason : undefined,
```

Update the doc comment at line 73 to name the new fields.

- [ ] **Step 7: Run tests to verify they pass**

Run: `bun test test/markdown/`
Expected: PASS.

- [ ] **Step 8: Update the spec**

`docs/spec.md` §2.6, two rows in the frontmatter table:

```markdown
| `outcome`      | `completed` \| `cancelled` | Done files only. Absent means `completed`. Any other value is `invalid-frontmatter`. |
| `cancelled_reason` | string            | Cancelled files only.                                                   |
```

Add below the table: "Either key in an open task's file is `invalid-frontmatter` (error), and the field is ignored."

§2.5, extend the reserved-keys bullet: "`title`, `completed_at`, `group`, `id`, `outcome` and `cancelled_reason` MUST NOT appear on a metadata line."

- [ ] **Step 9: Run the gate and commit**

```bash
bun run check
git add src/markdown docs/spec.md test/markdown
git commit -m "Read and write outcome and cancelled_reason in task files"
```

---

### Task 7: The file-system store cancels

**Files:**
- Modify: `src/fs/writing.ts:35-65` (beside `completeEntry`)
- Modify: `src/fs/snapshot.ts:70-90`
- Modify: `src/fs/FsTodoStore.ts` (the `cancel` method and capabilities)
- Test: `test/fs/writing.test.ts`, `test/fs/conformance.test.ts` (no change needed — it will start running the new cases)

**Interfaces:**
- Consumes: `updateTaskFile`/`formatTaskFile` with the new fields (Task 6); `TodoStore.cancel` (Task 2); `cancellingCases` (Task 3).
- Produces: `cancelEntry(files, snapshot, entry, reason): Effect.Effect<Task, StoreError>`; `FsTodoStore` declares `cancel: true`.

- [ ] **Step 1: Write the failing test**

In `test/fs/writing.test.ts`, following the existing `completeEntry` test's setup idiom:

```ts
  test("cancelling writes the done file with the outcome and reason, and removes the item", async () => {
    // Arrange the same way the completeEntry test above does.
    const cancelled = await run(cancelEntry(files, snapshot, entry, "Superseded by d47fcd2."))
    expect(cancelled.outcome).toBe("cancelled")
    expect(cancelled.cancelledReason).toBe("Superseded by d47fcd2.")
    const source = await read("todo/done/12-register-apps.md")
    expect(source).toContain("outcome: cancelled")
    expect(source).toContain("cancelled_reason: Superseded by d47fcd2.")
    expect(await read("todo/TODO.md")).not.toContain("12 - ")
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/fs/writing.test.ts`
Expected: FAIL — `cancelEntry` is not exported.

- [ ] **Step 3: Implement `cancelEntry`**

In `src/fs/writing.ts`, beside `completeEntry`. It follows the **same spec §2.10 order** — write the done file (the commit point), delete the original, then remove the item — so the two share everything but the outcome:

```ts
/**
 * Cancels an entry. Identical to `completeEntry` in file order (spec §2.10);
 * what differs is the outcome and the recorded reason.
 */
export const cancelEntry = (
  files: Files,
  snapshot: Snapshot,
  entry: Entry,
  reason: string,
): Effect.Effect<Task, StoreError> =>
  Effect.gen(function* () {
    const group = entry.section.name
    const cancelled: Task = {
      ...entryTask(entry),
      status: "done",
      outcome: "cancelled",
      cancelledReason: reason,
      completedAt: yield* DateTime.now,
      group,
    }
    const donePath = taskPath(snapshot.todo.config.doneDir, group, entry.id, cancelled.title)
    const source =
      entry.source === undefined
        ? formatTaskFile(taskFileFor(cancelled))
        : updateTaskFile(entry.source, {
            group: group ?? null,
            completedAt: cancelled.completedAt ?? null,
            outcome: "cancelled",
            cancelledReason: reason,
            ...(entry.file?.title === undefined ? { title: cancelled.title } : {}),
          })
    yield* files.write(donePath, source)
    const original = entry.item.path
    if (entry.item.linked && original !== undefined && original !== donePath)
      yield* files.remove(original)
    yield* files.write(todoPath, removeItem(snapshot.todo, entry.item))
    return cancelled
  })
```

In `completeEntry`, add `outcome: "completed",` to the `done` task and `outcome: "completed",` to the `updateTaskFile` changes, so completed files state their outcome explicitly.

- [ ] **Step 4: Read the outcome back**

In `src/fs/snapshot.ts`, where a done file becomes a `Task` (around line 88), carry the two fields from the parsed file:

```ts
    status: "done",
    outcome: file.outcome,
    cancelledReason: file.cancelledReason,
```

At line 75, where an item's checkbox decides the status, a hand-ticked `[x]` has no outcome, which reads as `completed` — leave it `undefined`.

- [ ] **Step 5: Wire it into the store**

In `src/fs/FsTodoStore.ts`, add `cancelEntry` to the import from `./writing.ts` at line 64, and add `cancel` directly after `complete` (line 304). It uses the same `mutate` wrapper, which takes the lock and normalizes first (line 187-189). The empty-reason check goes **outside** `mutate`, so a bad call never takes the lock:

```ts
      cancel: (id, reason) =>
        reason.trim() === ""
          ? new ValidationError({ issues: [`cancelling task ${id} needs a reason`] })
          : mutate((snapshot) =>
              findOpen(snapshot, id, "cancel").pipe(
                Effect.flatMap((entry) => cancelEntry(files, snapshot, entry, reason)),
              ),
            ),
```

`capabilities` at line 192 is `allCapabilities`, which already includes `cancel: true` from Task 1 — no change needed there. Confirm `ValidationError` is imported in this file; if not, add it from `../spec/index.ts` alongside the other errors.

- [ ] **Step 6: Run the tests**

Run: `bun test test/fs/`
Expected: PASS, including `test/fs/conformance.test.ts`, which now runs the eight cancelling cases against the real store with no change to that file.

- [ ] **Step 7: Run the gate and commit**

```bash
bun run check
git add src/fs test/fs
git commit -m "Cancel a task in the file-system store"
```

---

### Task 8: Expose cancel on the core service

**Files:**
- Modify: `src/core/TodoService.ts:90-100` (the interface), `:200-215` (beside `complete` and `reopen`)
- Modify: `src/core/README.md`
- Test: `test/core/TodoService.test.ts`

**Interfaces:**
- Consumes: `TodoStore.cancel` (Task 2).
- Produces: `TodoService.cancel(id: TaskId, reason: string): Effect.Effect<Task, TaskNotFound | InvalidTransition | ValidationError | Unsupported | StoreError>`.

Note it returns a plain `Task`, **not** the `Completion` that `complete` returns. `Completion` carries the tasks the completion made ready, and a cancellation makes nothing ready — that is Task 4's rule. Returning `Completion` here would invite a caller to print an always-empty list.

- [ ] **Step 1: Write the failing test**

In `test/core/TodoService.test.ts`, following its existing idiom:

```ts
  effectTest(
    "cancel abandons the task and unblocks nothing",
    Effect.gen(function* () {
      const todo = yield* TodoService
      const blocker = yield* todo.add({ title: "First" })
      const blocked = yield* todo.add({ title: "Second", dependsOn: [blocker.id] })
      const cancelled = yield* todo.cancel(blocker.id, "Not doing this.")
      expect(cancelled.outcome).toBe("cancelled")
      const views = yield* todo.next()
      expect(views.map((v) => v.task.id)).not.toContain(blocked.id)
    }),
    layer,
  )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/core/TodoService.test.ts`
Expected: FAIL — `todo.cancel is not a function`.

- [ ] **Step 3: Implement it**

Add to the `TodoService` interface after `complete`:

```ts
    /** Abandons an open task, recording why (spec §1.4). Unblocks nothing. */
    cancel(
      id: TaskId,
      reason: string,
    ): Effect.Effect<
      Task,
      TaskNotFound | InvalidTransition | ValidationError | Unsupported | StoreError
    >
```

and beside `reopen` at line 211, which is a straight delegation:

```ts
        cancel: (id, reason) => store.cancel(id, reason),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/core/TodoService.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the module README, run the gate, commit**

Add `cancel` to the operations table in `src/core/README.md`.

```bash
bun run check
git add src/core test/core
git commit -m "Expose cancel on the core service"
```

---

### Task 9: `todo cancel`

**Files:**
- Modify: `src/cli/commands/tasks.ts` (after the `done` command at line 273), and the command's registration in `src/cli/main.ts`
- Modify: `src/cli/render.ts:45-95`
- Modify: `src/cli/README.md`
- Test: `test/cli/tasks.test.ts`, `test/cli/render.test.ts`, `test/cli/help.test.ts` (already covers every command — it will fail until the new one has a description, flag descriptions and examples)

**Interfaces:**
- Consumes: `TodoService.cancel` (Task 8); `textOf` from `src/cli/context.ts:42` for `--reason -`; `idArgument`, `refOf`, `withTodo`, `output` from the existing commands.
- Produces: the `cancel` command export.

- [ ] **Step 1: Write the failing test**

In `test/cli/tasks.test.ts`, following its existing idiom:

```ts
  test("cancel records the reason and takes the task off the list", async () => {
    const { stdout } = await todo(["cancel", "1", "--reason", "Superseded by d47fcd2."])
    expect(stdout).toContain("Cancelled 01")
    expect(await read("todo/done/01-first.md")).toContain("cancelled_reason: Superseded by d47fcd2.")
    expect(await read("todo/TODO.md")).not.toContain("01 - ")
  })

  test("cancel reads the reason from stdin when given -", async () => {
    const { stdout } = await todo(["cancel", "1", "--reason", "-"], { stdin: "Dropped: `apps/*` is gone.\n" })
    expect(stdout).toContain("Cancelled 01")
    expect(await read("todo/done/01-first.md")).toContain("`apps/*` is gone.")
  })

  test("cancel without a reason is a usage error", async () => {
    const { stderr, exitCode } = await todo(["cancel", "1"])
    expect(exitCode).not.toBe(0)
    expect(stderr).toContain("--reason")
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/cli/tasks.test.ts`
Expected: FAIL — unknown command `cancel`.

- [ ] **Step 3: Add the command**

In `src/cli/commands/tasks.ts`, after `done`. `--reason` is **required**, which is what makes the reason a guarantee rather than a hope:

```ts
export const cancel = Command.make(
  "cancel",
  {
    id: idArgument,
    reason: Flag.string("reason").pipe(
      Flag.withDescription(`Why the task is being abandoned (required). ${orStdin}`),
    ),
  },
  Effect.fn(function* ({ id, reason }) {
    const ref = refOf(id)
    const text = yield* textOf("reason", reason)
    yield* withTodo(
      (todo, project) =>
        Effect.gen(function* () {
          const cancelled = yield* todo.cancel(ref.id, text)
          yield* output(project, cancelled, (style) => renderCancellation(cancelled, style))
          yield* warnUnpushed(project)
        }),
      { project: yield* projectOfRefs([ref]) },
    )
  }),
).pipe(
  Command.withDescription(
    "Abandon a task: it moves to done/ recorded as cancelled, with the reason, and satisfies no dependency",
  ),
  Command.withExamples([
    {
      command: 'todo cancel 12 --reason "Superseded: there is no apps/ directory."',
      description: "Cancel task 12, recording why",
    },
    {
      command: "todo cancel 12 --reason - <<'EOF'",
      description: "Take the reason from stdin, so backticks and $(…) reach the task verbatim",
    },
  ]),
)
```

Register it in `src/cli/main.ts` alongside `done` and `reopen`.

- [ ] **Step 4: Render it**

In `src/cli/render.ts`, add `renderCancellation` beside `renderCompletions` (line 177). It is much simpler than its sibling, because a cancellation unblocks nothing — there is no "Now ready" half:

```ts
/** `todo cancel`: what was abandoned, and why. Nothing becomes ready (spec §1.3). */
export const renderCancellation = (task: Task, _style: Style): string[] => [
  `Cancelled ${label(task)}`,
  ...(task.cancelledReason === undefined ? [] : [`  ${task.cancelledReason}`]),
]
```

Then make listings distinguish the two outcomes. At line 51, `v.state === "done"` prints the day; mark cancelled tasks so `todo ls --done` does not show abandoned work as finished:

```ts
    const extra =
      v.state === "done"
        ? v.task.outcome === "cancelled"
          ? `${day(v.task)} cancelled`
          : day(v.task)
        : meta(v.task)
```

Add a `test/cli/render.test.ts` case asserting a cancelled task's line carries `cancelled` and a completed one does not.

- [ ] **Step 5: Run the tests**

Run: `bun test test/cli/`
Expected: PASS, including `test/cli/help.test.ts`, which checks the new command has a description, a description per flag and argument, and examples.

- [ ] **Step 6: Update the README, run the gate, commit**

Add `cancel` to the command table in `src/cli/README.md`.

```bash
bun run check
git add src/cli test/cli
git commit -m "Add the todo cancel command"
```

---

### Task 10: The web app shows and records cancellation

**Files:**
- Modify: `src/web/app/ui/task.tsx:15`
- Modify: `src/web/app/actions/tasks/controller.tsx:355-370`
- Modify: `src/web/app/actions/forms.ts`
- Test: `test/web/` (follow the existing controller and ui test files)

**Interfaces:**
- Consumes: `TodoService.cancel` (Task 8); `Task.outcome`, `Task.cancelledReason` (Task 1); `capabilities.cancel` (Task 1).
- Produces: no exports other tasks depend on. This is the last task.

- [ ] **Step 1: Write the failing test**

In the web UI test file that covers `task.tsx`:

```ts
  test("a cancelled task reads as cancelled, with the reason", () => {
    const html = render(
      taskDetail(
        task({
          id: "12",
          status: "done",
          outcome: "cancelled",
          cancelledReason: "Superseded by d47fcd2.",
        }),
      ),
    )
    expect(html).toContain("Cancelled")
    expect(html).toContain("Superseded by d47fcd2.")
    expect(html).not.toContain("Completed")
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/web/`
Expected: FAIL — the detail rows are hardcoded to `"Completed"` at `src/web/app/ui/task.tsx:15`.

- [ ] **Step 3: Make the label outcome-aware**

Replace line 15's hardcoded row:

```tsx
    ...(task.status === "done"
      ? task.outcome === "cancelled"
        ? [
            ["Cancelled", formatDate(task.completedAt)],
            ...(task.cancelledReason === undefined ? [] : [["Reason", task.cancelledReason]]),
          ]
        : [["Completed", formatDate(task.completedAt)]]
      : []),
```

- [ ] **Step 4: Add the cancel action**

In `src/web/app/actions/tasks/controller.tsx`, add a cancel action beside the complete action at line 364, taking a required reason field from the form (`src/web/app/actions/forms.ts`). Per spec §1.5, **hide the control when `capabilities.cancel` is false** rather than offering it and failing.

- [ ] **Step 5: Run the tests**

Run: `bun test test/web/`
Expected: PASS.

- [ ] **Step 6: Run the gate and commit**

```bash
bun run check
git add src/web test/web
git commit -m "Show and record cancellation in the web app"
```

---

### Task 11: Cancel task 12, the case that prompted this

The feature's first real use, and an end-to-end check that the whole path works on the repo's own list.

**Files:**
- Modify: `todo/TODO.md`, `todo/done/12-register-repos-todo-md-apps-in-lemol-workspace.md`

- [ ] **Step 1: Reopen it**

```bash
bun src/cli/bin.ts reopen 12
bun src/cli/bin.ts show 12
```

Expected: task 12 is open again, with no `completed_at`.

- [ ] **Step 2: Cancel it with the real reason**

```bash
bun src/cli/bin.ts cancel 12 --reason - <<'EOF'
Superseded by d47fcd2, which moved the web app into src/web. There is no
apps/ directory, and the workspace's `repos/*` glob plus the
`@lemol/todo-md` override already cover this repository.
EOF
```

- [ ] **Step 3: Verify**

```bash
bun src/cli/bin.ts show 12
git diff
```

Expected: `show` reports it cancelled with the reason; the done file carries `outcome: cancelled` and `cancelled_reason`; `TODO.md` is unchanged from its current state (the task was already off the list).

- [ ] **Step 4: Run the gate and commit**

```bash
bun run check
git add todo/
git commit -m "Cancel task 12 rather than claiming it was completed"
```

---

## Self-review notes

**Spec coverage.** Every section of the design doc maps to a task: §1.1 → Task 1; §1.3 → Task 4; §1.4 → Tasks 2 and 8; §1.5 → Tasks 1 and 3; §1.6 → Task 5; §2.4 (no change) → none needed; §2.5, §2.6 → Task 6; §2.8, §2.11 (no change) → none needed; Part 3's implementation table → Tasks 2, 3, 5, 6, 7, 9, 10. The design's "First use" section → Task 11.

**Type consistency.** `TaskOutcome`, `Task.outcome`, `Task.cancelledReason`, `Capabilities.cancel`, `cancel(id, reason)`, `satisfiedIds`, `cancelEntry(files, snapshot, entry, reason)` and `cancelled-dependency` are spelled identically everywhere they appear. `test/core/views.test.ts:48` asserts on `board.doneIds` today and is updated in Task 4, Step 1 — that is the only existing test the rename touches.

**Assumptions to confirm before writing, not guesses to paper over:**

- **Task 3, Step 4** needs `Unsupported` imported in `src/spec/MemoryTodoStore.ts`, and assumes `MemoryTodoStore.layer` already takes an options object (it takes `{ title, description }` today). Extend that object rather than adding a second parameter.
- **Task 6, Step 5** assumes `fields` in `updateTaskFile` is a mutable record keyed by frontmatter name, as the `completed_at` handling at line 233 implies. Read it first.
- **Task 10, Step 4** is the one step that names a shape without a body: the web cancel action follows the complete action at `src/web/app/actions/tasks/controller.tsx:364` and its form helper, whose idiom should be copied from the sibling rather than invented. Read both before writing.

**Ordering.** Tasks 1→8 are a strict chain; each needs the one before it. Tasks 9 and 10 both depend on Task 8 but not on each other, so they can go in either order or in parallel. Task 11 needs Task 9.
