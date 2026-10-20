import { Context, Effect, FileSystem, Layer, Path, Schema, Stream } from "effect"
import {
  type Source,
  type SourceEnv,
  SourceError,
  type SourceProject,
  watchList,
} from "../hub/index.ts"
import { TodoStore } from "../spec/index.ts"
import { SqliteDriver } from "./SqliteDriver.ts"
import * as SqliteTodoStore from "./SqliteTodoStore.ts"

export const SqliteConfig = Schema.Struct({
  path: Schema.optional(
    Schema.String.check(
      Schema.makeFilter((path: string) => path.startsWith("/") || "must be an absolute path"),
    ),
  ),
})
export type SqliteConfig = typeof SqliteConfig.Type

export const defaultFile = "todo.db"

export const databaseFile = (
  project: SourceProject<SqliteConfig>,
): Effect.Effect<string, SourceError, Path.Path> =>
  Effect.gen(function* () {
    const paths = yield* Path.Path

    if (project.config.path !== undefined) {
      return project.config.path
    }

    if (project.dir !== undefined) {
      return paths.join(project.dir, defaultFile)
    }

    return yield* Effect.fail(
      new SourceError({
        name: project.name,
        message: "a sqlite project must be registered before it can be opened",
      }),
    )
  })

export const sqliteSourceWith = (driver: SqliteDriver["Service"]): Source<SqliteConfig> => ({
  kind: "sqlite",
  config: SqliteConfig,
  location: (config) => config.path ?? defaultFile,

  open: (project) =>
    Layer.unwrap(
      Effect.gen(function* () {
        const file = yield* databaseFile(project)
        const paths = yield* Path.Path
        const fs = yield* FileSystem.FileSystem

        yield* fs
          .makeDirectory(paths.dirname(file), { recursive: true })
          .pipe(
            Effect.mapError(
              (error) => new SourceError({ name: project.name, message: error.message }),
            ),
          )

        const storeLayer = SqliteTodoStore.layer({ path: file, title: project.name }).pipe(
          Layer.provide(Layer.succeed(SqliteDriver, driver)),
        )

        return Layer.effect(
          TodoStore,
          Effect.gen(function* () {
            const context = yield* Layer.build(storeLayer).pipe(
              Effect.mapError(
                (error) => new SourceError({ name: project.name, message: error.message }),
              ),
            )

            const store = Context.get(context, TodoStore)

            yield* store
              .load()
              .pipe(
                Effect.mapError(
                  (error) => new SourceError({ name: project.name, message: error.message }),
                ),
              )

            return store
          }),
        )
      }),
    ),

  changes: (project) => {
    const stop = (reason: string): Stream.Stream<void, never, SourceEnv> =>
      Stream.drain(
        Stream.fromEffect(Effect.logWarning(`stopped watching ${project.name}: ${reason}`)),
      )

    return Stream.unwrap(
      Effect.gen(function* () {
        const file = yield* databaseFile(project)
        const paths = yield* Path.Path
        const dir = paths.dirname(file)
        const base = paths.basename(file)
        const wal = `${base}-wal`

        return watchList(dir, {
          recursive: false,
          ignore: (p) => {
            const name = paths.basename(p)

            return name !== base && name !== wal
          },
        })
      }),
    ).pipe(Stream.catch((error) => stop(error.message)))
  },
})

export const make = (): Effect.Effect<Source<SqliteConfig>, never, SqliteDriver> =>
  Effect.map(SqliteDriver, sqliteSourceWith)
