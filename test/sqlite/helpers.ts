import { BunServices } from "@effect/platform-bun"
import { Effect, FileSystem, Layer } from "effect"
import * as BunSqliteDriver from "../../src/cli/BunSqliteDriver.ts"
import { SqliteTodoStore } from "../../src/sqlite/index.ts"

/** A store over a fresh `todo.db` in its own temporary directory, removed afterwards. */
export const freshStore = (title = "Conformance") =>
  Layer.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "todo-md-sqlite-" })

      return SqliteTodoStore.layer({ path: `${dir}/todo.db`, title })
    }),
  ).pipe(Layer.provide(Layer.mergeAll(BunSqliteDriver.layer, BunServices.layer)))
