import { DateTime, Effect } from "effect"
import { StoreError } from "../spec/errors.ts"
import type { Comment, Task, TodoList } from "../spec/model.ts"
import { SqliteDriver } from "./SqliteDriver.ts"
import { init, type Options } from "./SqliteTodoStore.ts"

/** What a store reads: `load()` and `listDone()`. */
export interface Snapshot {
  readonly list: TodoList
  readonly done: ReadonlyArray<Task>
}

const storeError = (error: unknown): StoreError =>
  error instanceof StoreError
    ? error
    : new StoreError({
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      })

/** Fills the empty list at `options.path` with `from`, IDs, timestamps and order kept. */
export const importList = (
  options: Options,
  from: Snapshot,
): Effect.Effect<{ readonly open: number; readonly done: number }, StoreError, SqliteDriver> =>
  Effect.scoped(
    Effect.gen(function* () {
      const driver = yield* SqliteDriver
      const db = yield* driver.open(options.path).pipe(Effect.mapError(storeError))

      yield* init(db, options.title).pipe(Effect.mapError(storeError))

      yield* db
        .transaction(
          Effect.gen(function* () {
            const counts = yield* db.query(
              "SELECT (SELECT COUNT(*) FROM tasks) + (SELECT COUNT(*) FROM groups) AS total",
            )

            const total = Number(counts[0]?.total ?? 0)

            if (total > 0) {
              return yield* new StoreError({
                message: `${options.path} already holds a list; import fills only an empty one`,
              })
            }

            let maxId = 0
            const allTasks = [
              ...from.list.ungrouped,
              ...from.list.groups.flatMap((g) => g.tasks),
              ...from.done,
            ]

            for (const task of allTasks) {
              const n = Number.parseInt(task.id, 10)

              if (Number.isFinite(n) && n > maxId) {
                maxId = n
              }
            }

            yield* db.run(
              "UPDATE list SET title = ?, description = ?, last_id = MAX(last_id, ?) WHERE id = 1",
              [from.list.title, from.list.description, maxId],
            )

            for (let i = 0; i < from.list.groups.length; i++) {
              const group = from.list.groups[i]!

              yield* db.run("INSERT INTO groups (name, description, position) VALUES (?, ?, ?)", [
                group.name,
                group.description,
                i,
              ])
            }

            const insertComments = (taskId: string, comments: ReadonlyArray<Comment>) =>
              Effect.gen(function* () {
                const n = comments.length

                for (let i = 0; i < n; i++) {
                  const comment = comments[i]!
                  const pos = n - 1 - i

                  yield* db.run(
                    "INSERT INTO comments (task_id, position, author, at, body) VALUES (?, ?, ?, ?, ?)",
                    [taskId, pos, comment.author, DateTime.formatIso(comment.at), comment.body],
                  )
                }
              })

            for (let i = 0; i < from.list.ungrouped.length; i++) {
              const task = from.list.ungrouped[i]!

              yield* db.run(
                "INSERT INTO tasks (id, title, description, status, outcome, group_name, position, tags, assignee, depends_on, completed_at, cancelled_reason, extra) VALUES (?, ?, ?, 'open', NULL, NULL, ?, ?, ?, ?, NULL, NULL, ?)",
                [
                  task.id,
                  task.title,
                  task.description,
                  i,
                  JSON.stringify(task.tags),
                  task.assignee ?? null,
                  JSON.stringify(task.dependsOn),
                  JSON.stringify(task.extra),
                ],
              )

              yield* insertComments(task.id, task.comments)
            }

            for (const group of from.list.groups) {
              for (let i = 0; i < group.tasks.length; i++) {
                const task = group.tasks[i]!

                yield* db.run(
                  "INSERT INTO tasks (id, title, description, status, outcome, group_name, position, tags, assignee, depends_on, completed_at, cancelled_reason, extra) VALUES (?, ?, ?, 'open', NULL, ?, ?, ?, ?, ?, NULL, NULL, ?)",
                  [
                    task.id,
                    task.title,
                    task.description,
                    group.name,
                    i,
                    JSON.stringify(task.tags),
                    task.assignee ?? null,
                    JSON.stringify(task.dependsOn),
                    JSON.stringify(task.extra),
                  ],
                )

                yield* insertComments(task.id, task.comments)
              }
            }

            const doneCount = from.done.length

            for (let i = 0; i < doneCount; i++) {
              const task = from.done[i]!
              const pos = doneCount - 1 - i
              const completedAtIso = task.completedAt ? DateTime.formatIso(task.completedAt) : null

              yield* db.run(
                "INSERT INTO tasks (id, title, description, status, outcome, group_name, position, tags, assignee, depends_on, completed_at, cancelled_reason, extra) VALUES (?, ?, ?, 'done', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                  task.id,
                  task.title,
                  task.description,
                  task.outcome ?? null,
                  task.group ?? null,
                  pos,
                  JSON.stringify(task.tags),
                  task.assignee ?? null,
                  JSON.stringify(task.dependsOn),
                  completedAtIso,
                  task.cancelledReason ?? null,
                  JSON.stringify(task.extra),
                ],
              )

              yield* insertComments(task.id, task.comments)
            }
          }),
          "write",
        )
        .pipe(
          Effect.mapError((err) => {
            if (err instanceof StoreError) return err

            return storeError(err)
          }),
        )

      const openCount =
        from.list.ungrouped.length + from.list.groups.reduce((acc, g) => acc + g.tasks.length, 0)

      return {
        open: openCount,
        done: from.done.length,
      }
    }),
  )
