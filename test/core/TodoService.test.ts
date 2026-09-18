import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { TodoService } from "../../src/core/TodoService.ts"
import { MemoryTodoStore, TodoStore } from "../../src/spec/index.ts"
import { effectTest } from "../../src/spec/testing.ts"

const service = TodoService.layer.pipe(Layer.provideMerge(MemoryTodoStore.layer({ title: "Acme" })))

/** Adds tasks: 1 (ungrouped), 2 and 3 in Backend (3 depends on 2), 4 in Frontend (tagged, assigned). */
const seed = Effect.gen(function* () {
  const todo = yield* TodoService
  yield* todo.add({ title: "Write changelog" })
  yield* todo.add({ title: "Add rate limiting" }, { group: "Backend" })
  yield* todo.add({ title: "Load test", dependsOn: ["2"] }, { group: "Backend" })
  yield* todo.add({ title: "Fix layout", tags: ["bug"], assignee: "lemol" }, { group: "Frontend" })
  return todo
})

const ids = (views: ReadonlyArray<{ readonly task: { readonly id: string } }>) =>
  views.map((v) => v.task.id)

describe("TodoService queries", () => {
  effectTest(
    "list returns every section with its open tasks and their state",
    Effect.gen(function* () {
      const listing = yield* (yield* seed).list()
      expect(listing.title).toBe("Acme")
      expect(
        listing.sections.map((s) => [s.name, s.tasks.map((v) => [v.task.id, v.state])]),
      ).toEqual([
        [undefined, [["1", "ready"]]],
        [
          "Backend",
          [
            ["2", "ready"],
            ["3", "blocked"],
          ],
        ],
        ["Frontend", [["4", "ready"]]],
      ])
      expect(listing.done).toEqual([])
    }),
    service,
  )

  effectTest(
    "list filters by tag, assignee, group and state, keeping every section",
    Effect.gen(function* () {
      const todo = yield* seed
      const tasksOf = (listing: {
        readonly sections: ReadonlyArray<{
          readonly tasks: ReadonlyArray<{ readonly task: { readonly id: string } }>
        }>
      }) => listing.sections.flatMap((s) => ids(s.tasks))
      expect(tasksOf(yield* todo.list({ tags: ["bug"] }))).toEqual(["4"])
      expect(tasksOf(yield* todo.list({ assignee: "lemol" }))).toEqual(["4"])
      expect(tasksOf(yield* todo.list({ group: "Backend" }))).toEqual(["2", "3"])
      expect(tasksOf(yield* todo.list({ state: "blocked" }))).toEqual(["3"])
      expect((yield* todo.list({ tags: ["bug"] })).sections).toHaveLength(3)
    }),
    service,
  )

  effectTest(
    "list returns done tasks when asked, with or without open ones",
    Effect.gen(function* () {
      const todo = yield* seed
      yield* todo.complete("2")
      expect((yield* todo.list()).done).toEqual([])
      const done = yield* todo.list({ status: "done" })
      expect(done.sections).toEqual([])
      expect(done.done.map((v) => [v.task.id, v.state])).toEqual([["2", "done"]])
      const all = yield* todo.list({ status: "all" })
      expect(all.sections.flatMap((s) => ids(s.tasks))).toEqual(["1", "3", "4"])
      expect(ids(all.done)).toEqual(["2"])
    }),
    service,
  )

  effectTest(
    "next returns ready tasks in priority order, filtered",
    Effect.gen(function* () {
      const todo = yield* seed
      expect(ids(yield* todo.next())).toEqual(["1", "2", "4"])
      expect(ids(yield* todo.next({ group: "Frontend" }))).toEqual(["4"])
      yield* todo.complete("2")
      expect(ids(yield* todo.next())).toEqual(["1", "3", "4"])
    }),
    service,
  )

  effectTest(
    "show describes a task's dependencies and the tasks it blocks",
    Effect.gen(function* () {
      const todo = yield* seed
      const two = yield* todo.show("2")
      expect(two.view.state).toBe("ready")
      expect(two.dependencies).toEqual([])
      expect(ids(two.blocks)).toEqual(["3"])
      yield* todo.update("3", { dependsOn: ["2", "99"] })
      expect((yield* todo.show("3")).dependencies).toEqual([
        { id: "2", title: "Add rate limiting", state: "ready" },
        { id: "99", title: undefined, state: "unknown" },
      ])
      expect((yield* Effect.flip(todo.show("does-not-exist")))._tag).toBe("TaskNotFound")
    }),
    service,
  )

  effectTest(
    "check adds model problems to the store's diagnostics",
    Effect.gen(function* () {
      const todo = yield* seed
      expect(yield* todo.check()).toEqual([])
      yield* todo.update("1", { dependsOn: ["99"] })
      expect((yield* todo.check()).map((d) => [d.code, d.taskId])).toEqual([
        ["unknown-dependency", "1"],
      ])
    }),
    service,
  )
})

describe("TodoService mutations", () => {
  effectTest(
    "complete reports the open tasks it made ready",
    Effect.gen(function* () {
      const todo = yield* seed
      yield* todo.add({ title: "Release", dependsOn: ["2", "1"] })
      const completion = yield* todo.complete("2")
      expect(completion.task).toMatchObject({ id: "2", status: "done" })
      expect(ids(completion.unblocked)).toEqual(["3"])
      expect(ids((yield* todo.complete("1")).unblocked)).toEqual(["5"])
      expect(ids((yield* todo.complete("4")).unblocked)).toEqual([])
    }),
    service,
  )

  effectTest(
    "remove refuses while open tasks depend on the task, unless forced",
    Effect.gen(function* () {
      const todo = yield* seed
      const refused = yield* Effect.flip(todo.remove("2"))
      expect(refused).toMatchObject({ _tag: "HasDependents", id: "2", dependents: ["3"] })
      expect((yield* todo.show("2")).view.state).toBe("ready")
      yield* todo.remove("2", { force: true })
      expect((yield* Effect.flip(todo.show("2")))._tag).toBe("TaskNotFound")
      expect((yield* Effect.flip(todo.remove("does-not-exist")))._tag).toBe("TaskNotFound")
    }),
    service,
  )

  effectTest(
    "other mutations go to the store",
    Effect.gen(function* () {
      const todo = yield* seed
      yield* todo.update("1", { title: "Write the changelog" })
      yield* todo.move("1", { group: "Backend" })
      yield* todo.renameGroup("Backend", "Server")
      yield* todo.comment("1", { author: "lemol", body: "Started." })
      yield* todo.complete("4")
      yield* todo.reopen("4")
      const task = yield* (yield* TodoStore).get("1")
      expect(task).toMatchObject({ title: "Write the changelog", group: "Server" })
      expect(task.comments).toHaveLength(1)
      expect((yield* (yield* TodoStore).get("4")).status).toBe("open")
    }),
    service,
  )
})

// A store that supports nothing optional: core must refuse before calling it.
const limited = Layer.effect(
  TodoStore,
  Effect.gen(function* () {
    const store = yield* TodoStore
    return TodoStore.of({
      ...store,
      capabilities: {
        groups: false,
        reorder: false,
        renameGroup: false,
        comments: false,
        promote: false,
      },
    })
  }),
).pipe(Layer.provide(MemoryTodoStore.layer()))

describe("TodoService capability guards", () => {
  effectTest(
    "unsupported operations fail with Unsupported before reaching the store",
    Effect.gen(function* () {
      const todo = yield* TodoService
      const a = yield* todo.add({ title: "A" })
      const tags = (effect: Effect.Effect<unknown, { readonly _tag: string }>) =>
        Effect.map(Effect.flip(effect), (error) => error._tag)
      expect(yield* tags(todo.add({ title: "B" }, { group: "Backend" }))).toBe("Unsupported")
      expect(yield* tags(todo.add({ title: "B" }, { after: a.id }))).toBe("Unsupported")
      expect(yield* tags(todo.move(a.id, {}))).toBe("Unsupported")
      expect(yield* tags(todo.renameGroup("Backend", "Server"))).toBe("Unsupported")
      expect(yield* tags(todo.comment(a.id, { author: "lemol", body: "Hi." }))).toBe("Unsupported")
      expect(yield* tags(todo.promote(a.id))).toBe("Unsupported")
      expect((yield* (yield* TodoStore).load()).ungrouped.map((t) => t.id)).toEqual([a.id])
      expect((yield* (yield* TodoStore).get(a.id)).comments).toEqual([])
    }),
    TodoService.layer.pipe(Layer.provideMerge(limited)),
  )
})
