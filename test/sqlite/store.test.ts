import { describe, expect } from "bun:test"
import { Context, Effect, Layer } from "effect"
import * as BunSqliteDriver from "../../src/cli/BunSqliteDriver.ts"
import { allCapabilities, TodoStore } from "../../src/spec/index.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { SqliteDriver, SqliteTodoStore } from "../../src/sqlite/index.ts"
import { Disk, diskWith } from "../fs/helpers.ts"

const storeAt = (root: string, title = "Groceries") =>
  SqliteTodoStore.layer({ path: `${root}/todo.db`, title }).pipe(
    Layer.provide(BunSqliteDriver.layer),
  )

/** Runs `effect` against a store over `<disk root>/todo.db`, closed afterwards. */
const withStore = <A, E>(effect: Effect.Effect<A, E, TodoStore>, title?: string) =>
  Effect.flatMap(Disk, ({ root }) => effect.pipe(Effect.provide(storeAt(root, title))))

/** Runs SQL on `<disk root>/todo.db` through a connection of its own. */
const sql = (statement: string, params: ReadonlyArray<string> = []) =>
  Effect.gen(function* () {
    const { root } = yield* Disk
    const db = yield* (yield* SqliteDriver).open(`${root}/todo.db`)

    return yield* db.query(statement, params)
  }).pipe(Effect.scoped, Effect.provide(BunSqliteDriver.layer))

describe("SqliteTodoStore", () => {
  effectTest(
    "a new file starts empty, titled, with every capability but promote",
    withStore(
      Effect.gen(function* () {
        const store = yield* TodoStore

        expect(store.capabilities).toEqual({ ...allCapabilities, promote: false })
        expect(yield* store.load()).toEqual({
          title: "Groceries",
          description: "",
          ungrouped: [],
          groups: [],
        })
        expect(yield* store.diagnostics()).toEqual([])

        const task = yield* store.add({ title: "Buy oat milk" })
        const error = yield* Effect.flip(store.promote(task.id))

        expect(error._tag).toBe("Unsupported")
      }),
    ),
    diskWith({}),
  )

  effectTest(
    "keeps the list when reopened, and never reuses a removed task's ID",
    Effect.gen(function* () {
      yield* withStore(
        Effect.gen(function* () {
          const store = yield* TodoStore

          yield* store.add({ title: "Buy oat milk", tags: ["dairy"] })
          const second = yield* store.add({ title: "Return the bottles" }, { group: "Errands" })

          yield* store.remove(second.id)
        }),
      )

      const list = yield* withStore(
        Effect.gen(function* () {
          const store = yield* TodoStore

          expect((yield* store.add({ title: "Book the dentist" })).id).toBe("3")

          return yield* store.load()
        }),
        "Another title",
      )

      expect(list.title).toBe("Groceries")
      expect(list.ungrouped.map((task) => [task.id, task.title, task.tags])).toEqual([
        ["1", "Buy oat milk", ["dairy"]],
        ["3", "Book the dentist", []],
      ])
      expect(list.groups.map((group) => [group.name, group.tasks.length])).toEqual([["Errands", 0]])
    }),
    diskWith({}),
  )

  effectTest(
    "opens the file in WAL mode, with no lock file beside it",
    Effect.gen(function* () {
      const disk = yield* Disk

      yield* withStore(Effect.flatMap(TodoStore, (store) => store.add({ title: "Buy oat milk" })))

      expect(yield* sql("PRAGMA journal_mode")).toEqual([{ journal_mode: "wal" }])
      expect((yield* disk.tree()).filter((file) => !file.startsWith("todo.db"))).toEqual([])
    }),
    diskWith({}),
  )

  effectTest(
    "two stores on one file see each other's writes",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const first = Context.get(yield* Layer.build(storeAt(root)), TodoStore)
      const second = Context.get(yield* Layer.build(storeAt(root)), TodoStore)

      yield* first.add({ title: "Buy oat milk" })
      expect((yield* second.add({ title: "Return the bottles" })).id).toBe("2")
      expect((yield* first.load()).ungrouped.map((task) => task.title)).toEqual([
        "Buy oat milk",
        "Return the bottles",
      ])
    }),
    diskWith({}),
  )

  effectTest(
    "a row that fails the model is left out of load and reported by diagnostics",
    Effect.gen(function* () {
      yield* withStore(
        Effect.flatMap(TodoStore, (store) =>
          Effect.all([
            store.add({ title: "Buy oat milk" }),
            store.add({ title: "Return the bottles" }),
          ]),
        ),
      )
      yield* sql("UPDATE tasks SET tags = ? WHERE id = ?", ['["dairy", ', "1"])
      yield* withStore(
        Effect.gen(function* () {
          const store = yield* TodoStore

          expect((yield* store.load()).ungrouped.map((task) => task.id)).toEqual(["2"])

          const diagnostics = yield* store.diagnostics()

          expect(diagnostics).toHaveLength(1)
          expect(diagnostics[0]).toMatchObject({
            severity: "error",
            code: "invalid-task",
            taskId: "1",
          })
        }),
      )
    }),
    diskWith({}),
  )
})
