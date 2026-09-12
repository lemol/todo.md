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
