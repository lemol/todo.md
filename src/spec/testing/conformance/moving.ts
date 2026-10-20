import { Effect } from "effect"
import { TodoStore } from "../../TodoStore.ts"
import { equal, failsWith, layout } from "./assert.ts"
import { type ConformanceCase, given } from "./case.ts"

export const movingCases: ReadonlyArray<ConformanceCase> = [
  {
    name: "move reorders a task within its section",
    requires: ["reorder"],
    setup: true,
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const [a, b, c] = yield* given({ title: "A" }, { title: "B" }, { title: "C" })

      yield* store.move(c.id, { before: a.id })
      equal(yield* layout, [["", [c.id, a.id, b.id]]])
      yield* store.move(c.id, { after: b.id })
      equal(yield* layout, [["", [a.id, b.id, c.id]]])
    }),
  },
  {
    name: "move to another group appends the task there and updates its group",
    requires: ["groups", "reorder"],
    setup: true,
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const [a, b] = yield* given(
        { title: "A", placement: { group: "Backend" } },
        { title: "B", placement: { group: "Frontend" } },
      )

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
    setup: true,
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const [a, u] = yield* given({ title: "A", placement: { group: "Backend" } }, { title: "U" })

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
    setup: true,
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const [a] = yield* given({ title: "A", placement: { group: "Backend" } })

      yield* store.move(a.id, { group: "Later" })
      equal(yield* layout, [
        ["", []],
        ["Backend", []],
        ["Later", [a.id]],
      ])
    }),
  },
  {
    name: "move to the end of its own section keeps the moved task before the next add",
    requires: ["groups", "reorder"],
    setup: true,
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const [a, b, c] = yield* given({ title: "A" }, { title: "B" }, { title: "C" })

      yield* store.move(a.id, {})
      equal(yield* layout, [["", [b.id, c.id, a.id]]])

      const d = yield* store.add({ title: "D" })

      equal(yield* layout, [["", [b.id, c.id, a.id, d.id]]])

      const [v, u] = yield* given(
        { title: "V", placement: { group: "G" } },
        { title: "U", placement: { group: "G" } },
      )

      yield* store.move(v.id, { group: "G" })

      const w = yield* store.add({ title: "W" }, { group: "G" })

      equal(yield* layout, [
        ["", [b.id, c.id, a.id, d.id]],
        ["G", [u.id, v.id, w.id]],
      ])
    }),
  },
  {
    name: "move rejects done tasks, unknown IDs and self-anchors, changing nothing",
    requires: ["reorder"],
    setup: true,
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const [a, done] = yield* given({ title: "A" }, { title: "Done", done: true })

      yield* failsWith(store.move(done.id, {}), "InvalidTransition")
      yield* failsWith(store.move("does-not-exist", {}), "TaskNotFound")
      yield* failsWith(store.move(a.id, { before: "does-not-exist" }), "TaskNotFound")
      yield* failsWith(store.move(a.id, { before: a.id }), "ValidationError")
      equal(yield* layout, [["", [a.id]]])
    }),
  },
]
