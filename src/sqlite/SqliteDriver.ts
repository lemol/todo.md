import { Context, type Effect, Schema, type Scope } from "effect"

export type SqlValue = string | number | null

export type Row = Readonly<Record<string, SqlValue>>

export class SqliteError extends Schema.TaggedError<SqliteError>()("SqliteError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface SqliteConnection {
  readonly run: (sql: string, params?: ReadonlyArray<SqlValue>) => Effect.Effect<void, SqliteError>
  readonly query: (
    sql: string,
    params?: ReadonlyArray<SqlValue>,
  ) => Effect.Effect<ReadonlyArray<Row>, SqliteError>
  /** "write": BEGIN IMMEDIATE; "read": BEGIN. COMMIT on success, ROLLBACK on failure or interruption. One at a time per connection. */
  readonly transaction: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    mode?: "read" | "write",
  ) => Effect.Effect<A, E | SqliteError, R>
}

export class SqliteDriver extends Context.Service<
  SqliteDriver,
  {
    /** Opens (creating) the file; closed when the scope closes. */
    readonly open: (path: string) => Effect.Effect<SqliteConnection, SqliteError, Scope.Scope>
  }
>()("@lemol/todo-md/sqlite/SqliteDriver") {}
