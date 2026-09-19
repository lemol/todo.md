import { Effect } from "effect"
import { TodoStore } from "../../TodoStore.ts"
import { equal, failsWith } from "./assert.ts"
import { type ConformanceCase, given } from "./case.ts"

export const updatingCases: ReadonlyArray<ConformanceCase> = [
  {
    name: "update changes the given fields and keeps the rest",
    setup: true,
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const [dependency, task] = yield* given(
        { title: "Dependency" },
        { title: "Old title", tags: ["api"], assignee: "lemol", extra: { estimate: 3 } },
      )
      const updated = yield* store.update(task.id, {
        title: "New title",
        description: "Details.",
        dependsOn: [dependency.id],
      })
      equal(updated.title, "New title")
      const stored = yield* store.get(task.id)
      equal(stored.title, "New title")
      equal(stored.description, "Details.")
      equal(stored.dependsOn, [dependency.id])
      equal(stored.tags, ["api"])
      equal(stored.assignee, "lemol")
      equal(stored.extra, { estimate: 3 })
    }),
  },
  {
    name: "update clears the assignee with null and replaces tags without duplicates",
    setup: true,
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const [task] = yield* given({ title: "Task", tags: ["a"], assignee: "lemol" })
      yield* store.update(task.id, { assignee: null, tags: ["x", "y", "x"] })
      const stored = yield* store.get(task.id)
      equal(stored.assignee, undefined)
      equal(stored.tags, ["x", "y"])
    }),
  },
  {
    name: "update works on a done task",
    setup: true,
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const [task] = yield* given({ title: "Old title", done: true })
      yield* store.update(task.id, { title: "New title" })
      const stored = yield* store.get(task.id)
      equal(stored.title, "New title")
      equal(stored.status, "done")
    }),
  },
  {
    name: "update allows a dependency on a task that no longer exists",
    requires: ["remove"],
    setup: true,
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      // Remove it after adding the other task: once no record of an ID remains,
      // a store may reuse it (spec §1.2).
      const [gone, task] = yield* given({ title: "Gone" }, { title: "Task" })
      yield* store.remove(gone.id)
      yield* store.update(task.id, { dependsOn: [gone.id] })
      equal((yield* store.get(task.id)).dependsOn, [gone.id])
    }),
  },
  {
    name: "update rejects invalid input, self-dependencies and cycles, changing nothing",
    setup: true,
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const [a] = yield* given({ title: "A" })
      const [b] = yield* given({ title: "B", dependsOn: [a.id] })
      yield* failsWith(store.update(a.id, { title: "" }), "ValidationError")
      yield* failsWith(store.update(a.id, { dependsOn: [a.id] }), "ValidationError")
      yield* failsWith(store.update(a.id, { dependsOn: [b.id] }), "ValidationError")
      const stored = yield* store.get(a.id)
      equal(stored.title, "A")
      equal(stored.dependsOn, [])
    }),
  },
]
