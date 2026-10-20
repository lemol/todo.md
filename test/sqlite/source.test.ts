import { describe, expect } from "bun:test"
import { Effect, Layer, Option, Queue, Stream } from "effect"
import * as BunSqliteDriver from "../../src/cli/BunSqliteDriver.ts"
import type { HubChange } from "../../src/hub/index.ts"
import { TodoStore } from "../../src/spec/index.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { SqliteSource, SqliteTodoStore } from "../../src/sqlite/index.ts"
import { Disk, diskWith, eventually, hubOn, liveTest, takeWithin } from "../hub/helpers.ts"

const sqliteSource = Effect.runSync(SqliteSource.make().pipe(Effect.provide(BunSqliteDriver.layer)))

describe("sqliteSource", () => {
  effectTest(
    "a project without path lives in its data directory, titled with its name",
    Effect.gen(function* () {
      const disk = yield* Disk
      const hub = yield* hubOn([sqliteSource])
      const info = yield* hub.add({ name: "groceries", source: "sqlite", config: {} })

      expect(info).toMatchObject({
        name: "groceries",
        source: "sqlite",
        location: "todo.db",
        syncable: false,
      })

      const todo = yield* hub.todo("groceries")

      yield* todo.add({ title: "Buy oat milk" })
      expect((yield* todo.list()).title).toBe("groceries")
      expect(yield* disk.exists(".todo-md/projects/groceries/todo.db")).toBe(true)
    }),
    diskWith({}),
  )

  effectTest(
    "a path is expanded, and its directory made on first open",
    Effect.gen(function* () {
      const disk = yield* Disk
      const hub = yield* hubOn([sqliteSource])
      const info = yield* hub.add({
        name: "groceries",
        source: "sqlite",
        config: { path: "~/notes/groceries.db" },
      })

      expect(info.location).toBe(`${disk.root}/notes/groceries.db`)
      yield* (yield* hub.todo("groceries")).add({ title: "Buy oat milk" })
      expect(yield* disk.exists("notes/groceries.db")).toBe(true)
    }),
    diskWith({}),
  )

  effectTest(
    "a relative path is refused",
    Effect.gen(function* () {
      const hub = yield* hubOn([sqliteSource])
      const error = yield* Effect.flip(
        hub.add({ name: "groceries", source: "sqlite", config: { path: "groceries.db" } }),
      )

      expect(error.message).toContain("must be an absolute path")
    }),
    diskWith({}),
  )

  effectTest(
    "removing deletes the file the hub placed and leaves a path file alone",
    Effect.gen(function* () {
      const disk = yield* Disk
      const hub = yield* hubOn([sqliteSource])

      yield* hub.add({ name: "placed", source: "sqlite", config: {} })
      yield* hub.add({ name: "given", source: "sqlite", config: { path: "~/given.db" } })
      yield* (yield* hub.todo("placed")).add({ title: "Buy oat milk" })
      yield* (yield* hub.todo("given")).add({ title: "Return the bottles" })
      yield* hub.remove("placed")
      yield* hub.remove("given")

      expect(yield* disk.exists(".todo-md/projects/placed/todo.db")).toBe(false)
      expect(yield* disk.exists("given.db")).toBe(true)
    }),
    diskWith({}),
  )

  liveTest(
    "another process's write is a change to the project",
    Effect.gen(function* () {
      const disk = yield* Disk
      const hub = yield* hubOn([sqliteSource])

      yield* hub.add({ name: "groceries", source: "sqlite", config: {} })
      yield* (yield* hub.todo("groceries")).add({ title: "Buy oat milk" })

      const events = yield* Queue.unbounded<HubChange>()

      yield* hub.changes.pipe(
        Stream.runForEach((change) => Queue.offer(events, change)),
        Effect.forkScoped,
      )

      const other = SqliteTodoStore.layer({
        path: `${disk.root}/.todo-md/projects/groceries/todo.db`,
        title: "groceries",
      }).pipe(Layer.provide(BunSqliteDriver.layer))

      const seen = yield* eventually(
        Effect.flatMap(TodoStore, (store) => store.add({ title: "Return the bottles" })).pipe(
          Effect.provide(other),
        ),
        takeWithin(events, "300 millis").pipe(
          Effect.map(
            Option.filter((change) => change.kind === "changed" && change.project === "groceries"),
          ),
        ),
      )

      expect(Option.isSome(seen)).toBe(true)
    }),
    diskWith({}),
  )
})
