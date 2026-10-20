import { Database } from "bun:sqlite"
import { Effect, Exit, Layer, Semaphore } from "effect"
import {
  type Row,
  type SqliteConnection,
  SqliteDriver,
  SqliteError,
  type SqlValue,
} from "../sqlite/index.ts"

const makeConnection = (rawDb: Database): Effect.Effect<SqliteConnection> =>
  Effect.gen(function* () {
    const sem = yield* Semaphore.make(1)

    const run = (sql: string, params?: ReadonlyArray<SqlValue>): Effect.Effect<void, SqliteError> =>
      Effect.try({
        try: () => {
          if (params === undefined || params.length === 0) {
            rawDb.run(sql)
          } else {
            rawDb.run(sql, params as (string | number | null)[])
          }
        },
        catch: (cause) =>
          new SqliteError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      })

    const query = (
      sql: string,
      params?: ReadonlyArray<SqlValue>,
    ): Effect.Effect<ReadonlyArray<Row>, SqliteError> =>
      Effect.try({
        try: () => {
          if (params === undefined || params.length === 0) {
            return rawDb.query(sql).all() as ReadonlyArray<Row>
          }

          return rawDb
            .query(sql)
            .all(...(params as (string | number | null)[])) as ReadonlyArray<Row>
        },
        catch: (cause) =>
          new SqliteError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      })

    const transaction = <A, E, R>(
      effect: Effect.Effect<A, E, R>,
      mode: "read" | "write" = "write",
    ): Effect.Effect<A, E | SqliteError, R> => {
      const beginSql = mode === "read" ? "BEGIN" : "BEGIN IMMEDIATE"

      const exec = Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          yield* run(beginSql)

          return yield* restore(effect).pipe(
            Effect.onExit((exit) => {
              if (!Exit.isSuccess(exit)) {
                return run("ROLLBACK").pipe(Effect.ignore)
              }

              return Effect.void
            }),
            Effect.flatMap((result) =>
              run("COMMIT").pipe(
                Effect.as(result),
                Effect.onError(() => run("ROLLBACK").pipe(Effect.ignore)),
              ),
            ),
          )
        }),
      )

      return sem.withPermit(exec)
    }

    return {
      run,
      query,
      transaction,
    }
  })

export const layer: Layer.Layer<SqliteDriver> = Layer.succeed(SqliteDriver, {
  open: (path: string) =>
    Effect.acquireRelease(
      Effect.try({
        try: () => new Database(path, { create: true, strict: true }),
        catch: (cause) =>
          new SqliteError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      }),
      (db) =>
        Effect.sync(() => {
          db.close()
        }),
    ).pipe(Effect.flatMap(makeConnection)),
})
