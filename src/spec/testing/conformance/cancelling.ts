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
      equal(
        done.map((t) => t.id),
        [task.id],
      )
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
      equal(cancelled.status, "done")
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
