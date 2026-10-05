import { Effect } from "effect"
import { TodoStore } from "../../TodoStore.ts"
import { equal, failsWith, layout } from "./assert.ts"
import { type ConformanceCase, given } from "./case.ts"

export const groupCases: ReadonlyArray<ConformanceCase> = [
  {
    name: "renameGroup renames a group in place, updating its tasks",
    requires: ["groups", "renameGroup"],
    setup: true,
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const [a, b] = yield* given(
        { title: "A", placement: { group: "Backend" } },
        { title: "B", placement: { group: "Frontend" } },
      )

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
    setup: true,
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const [a] = yield* given(
        { title: "A", placement: { group: "Backend" }, done: true },
        { title: "B", placement: { group: "Backend" } },
      )

      yield* store.renameGroup("Backend", "Server")
      equal((yield* store.get(a.id)).group, "Backend")
    }),
  },
  {
    name: "renameGroup rejects unknown groups and taken or invalid names, changing nothing",
    requires: ["groups", "renameGroup"],
    setup: true,
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const [a, b] = yield* given(
        { title: "A", placement: { group: "Backend" } },
        { title: "B", placement: { group: "Frontend" } },
      )

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
    setup: true,
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const [a] = yield* given({ title: "A", placement: { group: "Backend" }, done: true })

      yield* store.renameGroup("Backend", "Server")
      equal((yield* store.reopen(a.id)).group, undefined)
      equal(yield* layout, [
        ["", [a.id]],
        ["Server", []],
      ])
    }),
  },
]
