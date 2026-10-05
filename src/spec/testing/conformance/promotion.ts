import { Effect } from "effect"
import { TodoStore } from "../../TodoStore.ts"
import { equal, failsWith } from "./assert.ts"
import { type ConformanceCase, given } from "./case.ts"

/**
 * Promotion changes where a task's detail lives, not what it is, so what the
 * model can observe is that nothing observable changed. Whether a document
 * actually appeared is the adapter's own business: `test/fs` checks that.
 */
export const promotionCases: ReadonlyArray<ConformanceCase> = [
  {
    name: "promote leaves the task itself unchanged",
    requires: ["promote"],
    setup: true,
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const [{ id }] = yield* given({
        title: "Expose task promotion",
        description: "Spec §2.9 defines it; nothing exposes it.",
        tags: ["cli"],
        assignee: "lemol",
      })

      const before = yield* store.get(id)
      equal(yield* store.promote(id), before)
      equal(yield* store.get(id), before)
    }),
  },
  {
    name: "promote is a no-op the second time",
    requires: ["promote"],
    setup: true,
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const [{ id }] = yield* given({ title: "Rotate the token" })
      const promoted = yield* store.promote(id)
      equal(yield* store.promote(id), promoted)
    }),
  },
  {
    name: "promote works on a done task",
    requires: ["promote"],
    setup: true,
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const [task] = yield* given({ title: "Ship it" })
      const done = yield* store.complete(task.id)
      equal(yield* store.promote(task.id), done)
    }),
  },
  {
    name: "promote rejects an unknown task",
    requires: ["promote"],
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      yield* failsWith(store.promote("does-not-exist"), "TaskNotFound")
    }),
  },
  {
    name: "promote fails with Unsupported when the store cannot promote",
    setup: true,
    run: Effect.gen(function* () {
      const store = yield* TodoStore

      if (store.capabilities.promote) return

      const [task] = yield* given({ title: "Task" })
      yield* failsWith(store.promote(task.id), "Unsupported")
    }),
  },
]
