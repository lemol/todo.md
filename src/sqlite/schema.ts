import { type DateTime, Effect, Schema } from "effect"
import { Comment, Extra, Label, Task, TaskId } from "../spec/model.ts"
import type { Row } from "./SqliteDriver.ts"

export const statements: ReadonlyArray<string> = [
  "CREATE TABLE IF NOT EXISTS list (id INTEGER PRIMARY KEY CHECK (id = 1), title TEXT NOT NULL, description TEXT NOT NULL, last_id INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS groups (name TEXT PRIMARY KEY, description TEXT NOT NULL, position INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('open', 'done')), outcome TEXT, group_name TEXT, position INTEGER NOT NULL, tags TEXT NOT NULL, assignee TEXT, depends_on TEXT NOT NULL, completed_at TEXT, cancelled_reason TEXT, extra TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS comments (task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, position INTEGER NOT NULL, author TEXT NOT NULL, at TEXT NOT NULL, body TEXT NOT NULL)",
]

export const taskFromRow = (row: Row, comments: ReadonlyArray<Row>): Effect.Effect<Task, string> =>
  Effect.gen(function* () {
    const tags = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Label)))(
      row.tags,
    ).pipe(Effect.mapError((e) => e.message))

    const dependsOn = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(Schema.Array(TaskId)),
    )(row.depends_on).pipe(Effect.mapError((e) => e.message))

    const extra = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Extra))(row.extra).pipe(
      Effect.mapError((e) => e.message),
    )

    let completedAt: DateTime.Utc | undefined = undefined

    if (row.completed_at !== null && row.completed_at !== undefined && row.completed_at !== "") {
      completedAt = yield* Schema.decodeUnknownEffect(Schema.DateTimeUtcFromString)(
        row.completed_at,
      ).pipe(Effect.mapError((e) => e.message))
    }

    const decodedComments: Comment[] = []

    for (const c of comments) {
      const at = yield* Schema.decodeUnknownEffect(Schema.DateTimeUtcFromString)(c.at).pipe(
        Effect.mapError((e) => e.message),
      )

      const comment = yield* Schema.decodeUnknownEffect(Comment)({
        author: c.author,
        at,
        body: c.body,
      }).pipe(Effect.mapError((e) => e.message))

      decodedComments.push(comment)
    }

    const candidate = {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      outcome: row.outcome ?? undefined,
      tags,
      assignee: row.assignee ?? undefined,
      dependsOn,
      comments: decodedComments,
      group: row.group_name ?? undefined,
      completedAt,
      cancelledReason: row.cancelled_reason ?? undefined,
      extra,
    }

    return yield* Schema.decodeUnknownEffect(Task)(candidate).pipe(
      Effect.mapError((e) => e.message),
    )
  })
