import { describe, expect } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Effect, Exit, FileSystem, Layer } from "effect"
import * as BunSqliteDriver from "../../src/cli/BunSqliteDriver.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { SqliteDriver } from "../../src/sqlite/index.ts"

const env = Layer.mergeAll(BunSqliteDriver.layer, BunServices.layer)

/** A connection to a fresh file with one `notes` table, in a temporary directory. */
const opened = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "todo-md-sqlite-" })
  const db = yield* (yield* SqliteDriver).open(`${dir}/todo.db`)

  yield* db.run("CREATE TABLE notes (body TEXT NOT NULL)")

  return db
})

describe("BunSqliteDriver", () => {
  effectTest(
    "a failed transaction rolls back whole",
    Effect.gen(function* () {
      const db = yield* opened
      const exit = yield* Effect.exit(
        db.transaction(
          Effect.gen(function* () {
            yield* db.run("INSERT INTO notes (body) VALUES (?)", ["Ship the Acme invoice export"])

            return yield* Effect.fail("abandoned" as const)
          }),
          "write",
        ),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      expect(yield* db.query("SELECT body FROM notes")).toEqual([])
    }),
    env,
  )

  effectTest(
    "transactions on one connection run one at a time",
    Effect.gen(function* () {
      const db = yield* opened

      const write = (body: string) =>
        db.transaction(
          Effect.gen(function* () {
            yield* db.run("INSERT INTO notes (body) VALUES (?)", [body])
            yield* Effect.yieldNow
            yield* db.run("INSERT INTO notes (body) VALUES (?)", [`${body} again`])
          }),
          "write",
        )

      yield* Effect.all([write("Alpha"), write("Beta")], { concurrency: "unbounded" })

      const bodies = (yield* db.query("SELECT body FROM notes ORDER BY rowid")).map(
        (row) => row.body,
      )

      expect(bodies).toEqual(["Alpha", "Alpha again", "Beta", "Beta again"])
    }),
    env,
  )

  effectTest(
    "an SQL error fails with SqliteError",
    Effect.gen(function* () {
      const db = yield* opened
      const error = yield* Effect.flip(db.run("INSERT INTO missing VALUES (1)"))

      expect(error._tag).toBe("SqliteError")
      expect(error.message).toContain("no such table: missing")
    }),
    env,
  )
})
