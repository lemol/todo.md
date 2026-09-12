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
