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
