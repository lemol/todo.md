import { DateTime, Effect } from "effect"
import { TestClock } from "effect/testing"
import { TodoStore } from "../../TodoStore.ts"
import { equal, failsWith, layout } from "./assert.ts"
import { type ConformanceCase, given } from "./case.ts"

const at = Date.parse("2026-09-12T10:31:00Z")

const millis = (date: DateTime.Utc | undefined) =>
  date === undefined ? undefined : DateTime.toEpochMillis(date)

export const lifecycleCases: ReadonlyArray<ConformanceCase> = [
  {
    name: "complete marks the task done at the current time and takes it out of the list",
    setup: true,
    run: Effect.gen(function* () {
      const store = yield* TodoStore

      yield* TestClock.setTime(at)
      const [task] = yield* given({ title: "Ship it" })
      const done = yield* store.complete(task.id)

      equal(done.status, "done")
      equal(millis(done.completedAt), at)
      const stored = yield* store.get(task.id)

      equal(stored.status, "done")
      equal(millis(stored.completedAt), at)
      equal(yield* layout, [["", []]])
      equal(
        (yield* store.listDone()).map((t) => t.id),
        [task.id],
      )
    }),
  },
  {
    name: "complete records the group the task was in",
    requires: ["groups"],
    setup: true,
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const [task] = yield* given({ title: "Ship it", placement: { group: "Backend" } })

      yield* store.complete(task.id)
      equal((yield* store.get(task.id)).group, "Backend")
    }),
  },
  {
    name: "complete allows a blocked task and rejects a done one",
    setup: true,
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const [a] = yield* given({ title: "A" })
      const [b] = yield* given({ title: "B", dependsOn: [a.id] })

      yield* store.complete(b.id)
      yield* failsWith(store.complete(b.id), "InvalidTransition")
    }),
  },
  {
    name: "listDone returns the most recently completed task first",
    setup: true,
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const [a, b, c] = yield* given({ title: "A" }, { title: "B" }, { title: "C" })

      yield* store.complete(a.id)
      yield* TestClock.adjust("1 minute")
      yield* store.complete(c.id)
      yield* TestClock.adjust("1 minute")
      yield* store.complete(b.id)
      equal(
        (yield* store.listDone()).map((t) => t.id),
        [b.id, c.id, a.id],
      )
    }),
  },
  {
    name: "reopen puts the task back at the end of its section",
    setup: true,
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const [a, b] = yield* given({ title: "A" }, { title: "B" })

      yield* store.complete(a.id)
      const reopened = yield* store.reopen(a.id)

      equal(reopened.status, "open")
      equal(reopened.completedAt, undefined)
      equal(yield* layout, [["", [b.id, a.id]]])
      equal(yield* store.listDone(), [])
      yield* failsWith(store.reopen(a.id), "InvalidTransition")
    }),
  },
  {
    name: "reopen puts the task back at the end of its recorded group",
    requires: ["groups"],
    setup: true,
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const [a, b] = yield* given(
        { title: "A", placement: { group: "Backend" } },
        { title: "B", placement: { group: "Backend" } },
      )

      yield* store.complete(a.id)
      equal((yield* store.reopen(a.id)).group, "Backend")
      equal(yield* layout, [
        ["", []],
        ["Backend", [b.id, a.id]],
      ])
    }),
  },
  {
    name: "remove deletes open and done tasks",
    requires: ["remove"],
    setup: true,
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const [a, b] = yield* given({ title: "A" }, { title: "B", done: true })

      yield* store.remove(a.id)
      yield* store.remove(b.id)
      yield* failsWith(store.get(a.id), "TaskNotFound")
      yield* failsWith(store.get(b.id), "TaskNotFound")
      equal(yield* layout, [["", []]])
      equal(yield* store.listDone(), [])
    }),
  },
  {
    name: "remove fails with Unsupported when the store cannot remove",
    setup: true,
    run: Effect.gen(function* () {
      const store = yield* TodoStore

      if (store.capabilities.remove) return

      const [task] = yield* given({ title: "Task" })

      yield* failsWith(store.remove(task.id), "Unsupported")
    }),
  },
]
