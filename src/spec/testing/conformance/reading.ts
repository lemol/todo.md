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
