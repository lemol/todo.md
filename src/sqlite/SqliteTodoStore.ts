import { Cause, DateTime, Effect, Exit, Layer, Option } from "effect"
import type { Diagnostic } from "../spec/diagnostic.ts"
import {
  GroupNotFound,
  InvalidTransition,
  StoreError,
  TaskNotFound,
  Unsupported,
  ValidationError,
} from "../spec/errors.ts"
import {
  CommentInput,
  Label,
  Placement,
  type Task,
  type TaskId,
  TaskInput,
  TaskPatch,
  type TodoList,
} from "../spec/model.ts"
import { allCapabilities, TodoStore } from "../spec/TodoStore.ts"
import { ensureAcyclic, unique, validate } from "../spec/validation.ts"
import { statements, taskFromRow } from "./schema.ts"
import { type Row, type SqliteConnection, SqliteDriver } from "./SqliteDriver.ts"

export interface Options {
  readonly path: string
  /** Used only when the file has no list yet. */
  readonly title: string
}

const storeError = (error: unknown): StoreError =>
  new StoreError({
    message: error instanceof Error ? error.message : String(error),
    cause: error,
  })

export const init = (db: SqliteConnection, title: string) =>
  Effect.gen(function* () {
    yield* db.run("PRAGMA journal_mode = WAL")
    yield* db.run("PRAGMA busy_timeout = 5000")
    yield* db.run("PRAGMA foreign_keys = ON")

    yield* db.transaction(
      Effect.gen(function* () {
        for (const stmt of statements) {
          yield* db.run(stmt)
        }

        yield* db.run(
          "INSERT INTO list (id, title, description, last_id) SELECT 1, ?, '', 0 WHERE NOT EXISTS (SELECT 1 FROM list)",
          [title],
        )
      }),
      "write",
    )
  })

export const layer = (options: Options): Layer.Layer<TodoStore, StoreError, SqliteDriver> =>
  Layer.effect(
    TodoStore,
    Effect.gen(function* () {
      const driver = yield* SqliteDriver
      const db = yield* driver.open(options.path).pipe(Effect.mapError(storeError))

      yield* init(db, options.title).pipe(Effect.mapError(storeError))

      const resolvePlacement = (where: Placement, excludeId?: TaskId) =>
        Effect.gen(function* () {
          if (where.before !== undefined && where.after !== undefined) {
            return yield* new ValidationError({
              issues: ["a placement takes before or after, not both"],
            })
          }

          const anchorId = where.before ?? where.after

          if (anchorId === undefined) {
            const group = where.group
            const rows =
              excludeId === undefined
                ? yield* db.query(
                    "SELECT COUNT(*) as count FROM tasks WHERE status = 'open' AND group_name IS ?",
                    [group ?? null],
                  )
                : yield* db.query(
                    "SELECT COUNT(*) as count FROM tasks WHERE status = 'open' AND group_name IS ? AND id != ?",
                    [group ?? null, excludeId],
                  )

            const count = Number(rows[0]?.count ?? 0)

            return { group, index: count }
          }

          const anchorRows = yield* db.query(
            "SELECT group_name, position FROM tasks WHERE id = ? AND status = 'open'",
            [anchorId],
          )

          const anchor = anchorRows[0]

          if (anchor === undefined) {
            return yield* new TaskNotFound({ id: anchorId })
          }

          const group = (anchor.group_name as string) ?? undefined

          if (where.group !== undefined && where.group !== group) {
            return yield* new ValidationError({
              issues: [`task ${anchorId} is not in group ${where.group}`],
            })
          }

          const index =
            where.before !== undefined ? Number(anchor.position) : Number(anchor.position) + 1

          return { group, index }
        })

      const ensureGroupExists = (group: string | undefined) =>
        Effect.gen(function* () {
          if (group === undefined) return

          const rows = yield* db.query("SELECT position FROM groups WHERE name = ?", [group])

          if (rows.length === 0) {
            const maxRows = yield* db.query(
              "SELECT COALESCE(MAX(position), -1) as max_pos FROM groups",
            )

            const nextPos = Number(maxRows[0]?.max_pos ?? -1) + 1

            yield* db.run("INSERT INTO groups (name, description, position) VALUES (?, '', ?)", [
              group,
              nextPos,
            ])
          }
        })

      const verifyAcyclic = Effect.gen(function* () {
        const taskRows = yield* db.query("SELECT * FROM tasks")
        const commentRows = yield* db.query("SELECT * FROM comments ORDER BY position DESC")

        const commentsByTaskId = new Map<string, Row[]>()

        for (const c of commentRows) {
          const taskId = String(c.task_id)
          let list = commentsByTaskId.get(taskId)

          if (!list) {
            list = []
            commentsByTaskId.set(taskId, list)
          }

          list.push(c)
        }

        const all: Task[] = []

        for (const row of taskRows) {
          const t = yield* Effect.option(
            taskFromRow(row, commentsByTaskId.get(String(row.id)) ?? []),
          )

          if (Option.isSome(t)) {
            all.push(t.value)
          }
        }

        yield* ensureAcyclic(all)
      })

      return TodoStore.of({
        capabilities: { ...allCapabilities, promote: false },

        load: () =>
          db
            .transaction(
              Effect.gen(function* () {
                const listRows = yield* db.query("SELECT title, description FROM list WHERE id = 1")
                const listRow = listRows[0]
                const title = (listRow?.title as string) ?? ""
                const description = (listRow?.description as string) ?? ""

                const groupRows = yield* db.query(
                  "SELECT name, description, position FROM groups ORDER BY position ASC",
                )

                const taskRows = yield* db.query(
                  "SELECT * FROM tasks WHERE status = 'open' ORDER BY position ASC",
                )

                const commentRows = yield* db.query("SELECT * FROM comments ORDER BY position DESC")

                const commentsByTaskId = new Map<string, Row[]>()

                for (const c of commentRows) {
                  const taskId = String(c.task_id)
                  let list = commentsByTaskId.get(taskId)

                  if (!list) {
                    list = []
                    commentsByTaskId.set(taskId, list)
                  }

                  list.push(c)
                }

                const decodedTasks: Task[] = []

                for (const row of taskRows) {
                  const decoded = yield* Effect.option(
                    taskFromRow(row, commentsByTaskId.get(String(row.id)) ?? []),
                  )

                  if (Option.isSome(decoded)) {
                    decodedTasks.push(decoded.value)
                  }
                }

                const ungrouped = decodedTasks.filter((t) => t.group === undefined)
                const groups = groupRows.map((g) => {
                  const groupName = String(g.name)
                  const groupDesc = (g.description as string) ?? ""
                  const tasks = decodedTasks.filter((t) => t.group === groupName)

                  return {
                    name: groupName,
                    description: groupDesc,
                    tasks,
                  }
                })

                return {
                  title,
                  description,
                  ungrouped,
                  groups,
                } satisfies TodoList
              }),
              "read",
            )
            .pipe(Effect.mapError(storeError)),

        get: (id: TaskId) =>
          db
            .transaction(
              Effect.gen(function* () {
                const rows = yield* db.query("SELECT * FROM tasks WHERE id = ?", [id])
                const row = rows[0]

                if (row === undefined) {
                  return yield* new TaskNotFound({ id })
                }

                const comments = yield* db.query(
                  "SELECT * FROM comments WHERE task_id = ? ORDER BY position DESC",
                  [id],
                )

                return yield* taskFromRow(row, comments).pipe(
                  Effect.mapError(
                    (issue) => new StoreError({ message: `task ${id} is invalid: ${issue}` }),
                  ),
                )
              }),
              "read",
            )
            .pipe(
              Effect.mapError((err) => {
                if (err instanceof TaskNotFound || err instanceof StoreError) return err

                return storeError(err)
              }),
            ),

        listDone: () =>
          db
            .transaction(
              Effect.gen(function* () {
                const taskRows = yield* db.query(
                  "SELECT * FROM tasks WHERE status = 'done' ORDER BY position DESC",
                )

                const commentRows = yield* db.query("SELECT * FROM comments ORDER BY position DESC")

                const commentsByTaskId = new Map<string, Row[]>()

                for (const c of commentRows) {
                  const taskId = String(c.task_id)
                  let list = commentsByTaskId.get(taskId)

                  if (!list) {
                    list = []
                    commentsByTaskId.set(taskId, list)
                  }

                  list.push(c)
                }

                const decodedDone: Task[] = []

                for (const row of taskRows) {
                  const decoded = yield* Effect.option(
                    taskFromRow(row, commentsByTaskId.get(String(row.id)) ?? []),
                  )

                  if (Option.isSome(decoded)) {
                    decodedDone.push(decoded.value)
                  }
                }

                return decodedDone
              }),
              "read",
            )
            .pipe(Effect.mapError(storeError)),

        add: (input, placement = {}) =>
          db
            .transaction(
              Effect.gen(function* () {
                const valid = yield* validate(TaskInput, input)
                const where = yield* validate(Placement, placement)
                const target = yield* resolvePlacement(where)

                yield* ensureGroupExists(target.group)

                yield* db.run(
                  "UPDATE tasks SET position = position + 1 WHERE status = 'open' AND group_name IS ? AND position >= ?",
                  [target.group ?? null, target.index],
                )

                const listRows = yield* db.query("SELECT last_id FROM list WHERE id = 1")
                const lastId = Number(listRows[0]?.last_id ?? 0)
                const nextId = lastId + 1

                yield* db.run("UPDATE list SET last_id = ? WHERE id = 1", [nextId])

                const id = String(nextId)
                const task: Task = {
                  id,
                  title: valid.title,
                  description: valid.description ?? "",
                  status: "open",
                  tags: unique(valid.tags ?? []),
                  assignee: valid.assignee,
                  dependsOn: unique(valid.dependsOn ?? []),
                  comments: [],
                  group: target.group,
                  extra: valid.extra ?? {},
                }

                yield* db.run(
                  "INSERT INTO tasks (id, title, description, status, outcome, group_name, position, tags, assignee, depends_on, completed_at, cancelled_reason, extra) VALUES (?, ?, ?, 'open', NULL, ?, ?, ?, ?, ?, NULL, NULL, ?)",
                  [
                    id,
                    task.title,
                    task.description,
                    target.group ?? null,
                    target.index,
                    JSON.stringify(task.tags),
                    task.assignee ?? null,
                    JSON.stringify(task.dependsOn),
                    JSON.stringify(task.extra),
                  ],
                )

                yield* verifyAcyclic

                return task
              }),
              "write",
            )
            .pipe(
              Effect.mapError((err) => {
                if (
                  err instanceof ValidationError ||
                  err instanceof TaskNotFound ||
                  err instanceof Unsupported ||
                  err instanceof StoreError
                ) {
                  return err
                }

                return storeError(err)
              }),
            ),

        update: (id, patch) =>
          db
            .transaction(
              Effect.gen(function* () {
                const valid = yield* validate(TaskPatch, patch)
                const rows = yield* db.query("SELECT * FROM tasks WHERE id = ?", [id])
                const row = rows[0]

                if (row === undefined) {
                  return yield* new TaskNotFound({ id })
                }

                const commentRows = yield* db.query(
                  "SELECT * FROM comments WHERE task_id = ? ORDER BY position DESC",
                  [id],
                )

                const current = yield* taskFromRow(row, commentRows).pipe(
                  Effect.mapError(
                    (issue) => new StoreError({ message: `task ${id} is invalid: ${issue}` }),
                  ),
                )

                const updated: Task = {
                  ...current,
                  title: valid.title ?? current.title,
                  description: valid.description ?? current.description,
                  tags: valid.tags === undefined ? current.tags : unique(valid.tags),
                  assignee:
                    valid.assignee === undefined ? current.assignee : (valid.assignee ?? undefined),
                  dependsOn:
                    valid.dependsOn === undefined ? current.dependsOn : unique(valid.dependsOn),
                  extra: valid.extra ?? current.extra,
                }

                yield* db.run(
                  "UPDATE tasks SET title = ?, description = ?, tags = ?, assignee = ?, depends_on = ?, extra = ? WHERE id = ?",
                  [
                    updated.title,
                    updated.description,
                    JSON.stringify(updated.tags),
                    updated.assignee ?? null,
                    JSON.stringify(updated.dependsOn),
                    JSON.stringify(updated.extra),
                    id,
                  ],
                )

                yield* verifyAcyclic

                return updated
              }),
              "write",
            )
            .pipe(
              Effect.mapError((err) => {
                if (
                  err instanceof TaskNotFound ||
                  err instanceof ValidationError ||
                  err instanceof StoreError
                ) {
                  return err
                }

                return storeError(err)
              }),
            ),

        move: (id, placement) =>
          db
            .transaction(
              Effect.gen(function* () {
                const where = yield* validate(Placement, placement)

                if (where.before === id || where.after === id) {
                  return yield* new ValidationError({
                    issues: [`task ${id} cannot be placed next to itself`],
                  })
                }

                const rows = yield* db.query("SELECT * FROM tasks WHERE id = ?", [id])
                const row = rows[0]

                if (row === undefined) {
                  return yield* new TaskNotFound({ id })
                }

                if (row.status === "done") {
                  return yield* new InvalidTransition({ id, status: "done", operation: "move" })
                }

                const oldGroup = (row.group_name as string) ?? null
                const oldPos = Number(row.position)

                yield* db.run("UPDATE tasks SET position = -1 WHERE id = ?", [id])
                yield* db.run(
                  "UPDATE tasks SET position = position - 1 WHERE status = 'open' AND group_name IS ? AND position > ?",
                  [oldGroup, oldPos],
                )

                const target = yield* resolvePlacement(where, id)

                yield* ensureGroupExists(target.group)

                yield* db.run(
                  "UPDATE tasks SET position = position + 1 WHERE status = 'open' AND group_name IS ? AND position >= ?",
                  [target.group ?? null, target.index],
                )

                yield* db.run("UPDATE tasks SET group_name = ?, position = ? WHERE id = ?", [
                  target.group ?? null,
                  target.index,
                  id,
                ])

                const commentRows = yield* db.query(
                  "SELECT * FROM comments WHERE task_id = ? ORDER BY position DESC",
                  [id],
                )

                const updatedRow = {
                  ...row,
                  group_name: target.group ?? null,
                  position: target.index,
                }

                return yield* taskFromRow(updatedRow, commentRows).pipe(
                  Effect.mapError(
                    (issue) => new StoreError({ message: `task ${id} is invalid: ${issue}` }),
                  ),
                )
              }),
              "write",
            )
            .pipe(
              Effect.mapError((err) => {
                if (
                  err instanceof TaskNotFound ||
                  err instanceof InvalidTransition ||
                  err instanceof ValidationError ||
                  err instanceof Unsupported ||
                  err instanceof StoreError
                ) {
                  return err
                }

                return storeError(err)
              }),
            ),

        complete: (id) =>
          db
            .transaction(
              Effect.gen(function* () {
                const rows = yield* db.query("SELECT * FROM tasks WHERE id = ?", [id])
                const row = rows[0]

                if (row === undefined) {
                  return yield* new TaskNotFound({ id })
                }

                if (row.status === "done") {
                  return yield* new InvalidTransition({ id, status: "done", operation: "complete" })
                }

                const oldGroup = (row.group_name as string) ?? null
                const oldPos = Number(row.position)

                yield* db.run(
                  "UPDATE tasks SET position = position - 1 WHERE status = 'open' AND group_name IS ? AND position > ?",
                  [oldGroup, oldPos],
                )

                const maxDoneRows = yield* db.query(
                  "SELECT COALESCE(MAX(position), -1) as max_pos FROM tasks WHERE status = 'done'",
                )

                const nextPos = Number(maxDoneRows[0]?.max_pos ?? -1) + 1
                const now = yield* DateTime.now
                const iso = DateTime.formatIso(now)

                yield* db.run(
                  "UPDATE tasks SET status = 'done', outcome = 'completed', position = ?, completed_at = ? WHERE id = ?",
                  [nextPos, iso, id],
                )

                const commentRows = yield* db.query(
                  "SELECT * FROM comments WHERE task_id = ? ORDER BY position DESC",
                  [id],
                )

                const updatedRow = {
                  ...row,
                  status: "done",
                  outcome: "completed",
                  position: nextPos,
                  completed_at: iso,
                }

                return yield* taskFromRow(updatedRow, commentRows).pipe(
                  Effect.mapError(
                    (issue) => new StoreError({ message: `task ${id} is invalid: ${issue}` }),
                  ),
                )
              }),
              "write",
            )
            .pipe(
              Effect.mapError((err) => {
                if (
                  err instanceof TaskNotFound ||
                  err instanceof InvalidTransition ||
                  err instanceof StoreError
                ) {
                  return err
                }

                return storeError(err)
              }),
            ),

        cancel: (id, reason) =>
          db
            .transaction(
              Effect.gen(function* () {
                if (reason.trim() === "") {
                  return yield* new ValidationError({
                    issues: [`cancelling task ${id} needs a reason`],
                  })
                }

                const rows = yield* db.query("SELECT * FROM tasks WHERE id = ?", [id])
                const row = rows[0]

                if (row === undefined) {
                  return yield* new TaskNotFound({ id })
                }

                if (row.status === "done") {
                  return yield* new InvalidTransition({ id, status: "done", operation: "cancel" })
                }

                const oldGroup = (row.group_name as string) ?? null
                const oldPos = Number(row.position)

                yield* db.run(
                  "UPDATE tasks SET position = position - 1 WHERE status = 'open' AND group_name IS ? AND position > ?",
                  [oldGroup, oldPos],
                )

                const maxDoneRows = yield* db.query(
                  "SELECT COALESCE(MAX(position), -1) as max_pos FROM tasks WHERE status = 'done'",
                )

                const nextPos = Number(maxDoneRows[0]?.max_pos ?? -1) + 1
                const now = yield* DateTime.now
                const iso = DateTime.formatIso(now)

                yield* db.run(
                  "UPDATE tasks SET status = 'done', outcome = 'cancelled', cancelled_reason = ?, position = ?, completed_at = ? WHERE id = ?",
                  [reason, nextPos, iso, id],
                )

                const commentRows = yield* db.query(
                  "SELECT * FROM comments WHERE task_id = ? ORDER BY position DESC",
                  [id],
                )

                const updatedRow = {
                  ...row,
                  status: "done",
                  outcome: "cancelled",
                  cancelled_reason: reason,
                  position: nextPos,
                  completed_at: iso,
                }

                return yield* taskFromRow(updatedRow, commentRows).pipe(
                  Effect.mapError(
                    (issue) => new StoreError({ message: `task ${id} is invalid: ${issue}` }),
                  ),
                )
              }),
              "write",
            )
            .pipe(
              Effect.mapError((err) => {
                if (
                  err instanceof TaskNotFound ||
                  err instanceof InvalidTransition ||
                  err instanceof ValidationError ||
                  err instanceof Unsupported ||
                  err instanceof StoreError
                ) {
                  return err
                }

                return storeError(err)
              }),
            ),

        reopen: (id) =>
          db
            .transaction(
              Effect.gen(function* () {
                const rows = yield* db.query("SELECT * FROM tasks WHERE id = ?", [id])
                const row = rows[0]

                if (row === undefined) {
                  return yield* new TaskNotFound({ id })
                }

                if (row.status === "open") {
                  return yield* new InvalidTransition({ id, status: "open", operation: "reopen" })
                }

                let targetGroup: string | null = null

                if (row.group_name !== null && row.group_name !== undefined) {
                  const groupRows = yield* db.query("SELECT name FROM groups WHERE name = ?", [
                    row.group_name,
                  ])

                  if (groupRows.length > 0) {
                    targetGroup = row.group_name as string
                  }
                }

                const countRows = yield* db.query(
                  "SELECT COUNT(*) as count FROM tasks WHERE status = 'open' AND group_name IS ?",
                  [targetGroup],
                )

                const targetPos = Number(countRows[0]?.count ?? 0)

                yield* db.run(
                  "UPDATE tasks SET status = 'open', outcome = NULL, cancelled_reason = NULL, completed_at = NULL, group_name = ?, position = ? WHERE id = ?",
                  [targetGroup, targetPos, id],
                )

                const commentRows = yield* db.query(
                  "SELECT * FROM comments WHERE task_id = ? ORDER BY position DESC",
                  [id],
                )

                const updatedRow = {
                  ...row,
                  status: "open",
                  outcome: null,
                  cancelled_reason: null,
                  completed_at: null,
                  group_name: targetGroup,
                  position: targetPos,
                }

                return yield* taskFromRow(updatedRow, commentRows).pipe(
                  Effect.mapError(
                    (issue) => new StoreError({ message: `task ${id} is invalid: ${issue}` }),
                  ),
                )
              }),
              "write",
            )
            .pipe(
              Effect.mapError((err) => {
                if (
                  err instanceof TaskNotFound ||
                  err instanceof InvalidTransition ||
                  err instanceof StoreError
                ) {
                  return err
                }

                return storeError(err)
              }),
            ),

        remove: (id) =>
          db
            .transaction(
              Effect.gen(function* () {
                const rows = yield* db.query("SELECT * FROM tasks WHERE id = ?", [id])
                const row = rows[0]

                if (row === undefined) {
                  return yield* new TaskNotFound({ id })
                }

                if (row.status === "open") {
                  const group = (row.group_name as string) ?? null
                  const pos = Number(row.position)

                  yield* db.run(
                    "UPDATE tasks SET position = position - 1 WHERE status = 'open' AND group_name IS ? AND position > ?",
                    [group, pos],
                  )
                }

                yield* db.run("DELETE FROM tasks WHERE id = ?", [id])
              }),
              "write",
            )
            .pipe(
              Effect.mapError((err) => {
                if (
                  err instanceof TaskNotFound ||
                  err instanceof Unsupported ||
                  err instanceof StoreError
                ) {
                  return err
                }

                return storeError(err)
              }),
            ),

        renameGroup: (from, to) =>
          db
            .transaction(
              Effect.gen(function* () {
                const groupRows = yield* db.query("SELECT name FROM groups WHERE name = ?", [from])

                if (groupRows.length === 0) {
                  return yield* new GroupNotFound({ name: from })
                }

                const name = yield* validate(Label, to)

                if (name !== from) {
                  const existing = yield* db.query("SELECT name FROM groups WHERE name = ?", [name])

                  if (existing.length > 0) {
                    return yield* new ValidationError({ issues: [`group ${name} already exists`] })
                  }
                }

                yield* db.run("UPDATE groups SET name = ? WHERE name = ?", [name, from])
                yield* db.run(
                  "UPDATE tasks SET group_name = ? WHERE group_name = ? AND status = 'open'",
                  [name, from],
                )
              }),
              "write",
            )
            .pipe(
              Effect.mapError((err) => {
                if (
                  err instanceof GroupNotFound ||
                  err instanceof ValidationError ||
                  err instanceof Unsupported ||
                  err instanceof StoreError
                ) {
                  return err
                }

                return storeError(err)
              }),
            ),

        comment: (id, input) =>
          db
            .transaction(
              Effect.gen(function* () {
                const valid = yield* validate(CommentInput, input)
                const rows = yield* db.query("SELECT * FROM tasks WHERE id = ?", [id])
                const row = rows[0]

                if (row === undefined) {
                  return yield* new TaskNotFound({ id })
                }

                const maxCommentRows = yield* db.query(
                  "SELECT COALESCE(MAX(position), -1) as max_pos FROM comments WHERE task_id = ?",
                  [id],
                )

                const nextPos = Number(maxCommentRows[0]?.max_pos ?? -1) + 1
                const now = yield* DateTime.now
                const iso = DateTime.formatIso(now)

                yield* db.run(
                  "INSERT INTO comments (task_id, position, author, at, body) VALUES (?, ?, ?, ?, ?)",
                  [id, nextPos, valid.author, iso, valid.body],
                )

                return {
                  author: valid.author,
                  at: now,
                  body: valid.body,
                }
              }),
              "write",
            )
            .pipe(
              Effect.mapError((err) => {
                if (
                  err instanceof TaskNotFound ||
                  err instanceof ValidationError ||
                  err instanceof Unsupported ||
                  err instanceof StoreError
                ) {
                  return err
                }

                return storeError(err)
              }),
            ),

        promote: () => Effect.fail(new Unsupported({ operation: "promote" })),

        diagnostics: () =>
          db
            .transaction(
              Effect.gen(function* () {
                const taskRows = yield* db.query("SELECT * FROM tasks")
                const commentRows = yield* db.query("SELECT * FROM comments ORDER BY position DESC")

                const commentsByTaskId = new Map<string, Row[]>()

                for (const c of commentRows) {
                  const taskId = String(c.task_id)
                  let list = commentsByTaskId.get(taskId)

                  if (!list) {
                    list = []
                    commentsByTaskId.set(taskId, list)
                  }

                  list.push(c)
                }

                const issues: Diagnostic[] = []

                for (const row of taskRows) {
                  const res = yield* Effect.exit(
                    taskFromRow(row, commentsByTaskId.get(String(row.id)) ?? []),
                  )

                  if (Exit.isFailure(res)) {
                    const issue = Cause.findErrorOption(res.cause).pipe(
                      Option.getOrElse(() => Cause.pretty(res.cause)),
                    )

                    issues.push({
                      severity: "error",
                      code: "invalid-task",
                      taskId: String(row.id),
                      message: `task ${row.id} does not match the model: ${issue}`,
                    })
                  }
                }

                return issues
              }),
              "read",
            )
            .pipe(Effect.mapError(storeError)),
      })
    }),
  )
