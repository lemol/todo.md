import { describe, expect } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Effect, Layer } from "effect"
import * as BunSqliteDriver from "../../src/cli/BunSqliteDriver.ts"
import { FsTodoStore } from "../../src/fs/index.ts"
import { TodoStore } from "../../src/spec/index.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { importList, SqliteTodoStore } from "../../src/sqlite/index.ts"
import { Disk, diskWith, md } from "../fs/helpers.ts"

const list = {
  "list/TODO.md": md(
    "# Groceries",
    "",
    "Things to buy.",
    "",
    "- [ ] 01 - Buy oat milk",
    "- [x] 05 - Return the bottles",
    "",
    "## Backend",
    "",
    "Server work.",
    "",
    "- [ ] 07 - Fix the cache #infra",
    "- [ ] [02 - Add rate limiting](./backend/02-add-rate-limiting.md)",
    "",
    "## Empty",
  ),
  "list/backend/02-add-rate-limiting.md": md(
    "---",
    "title: Add rate limiting",
    "depends_on: [1]",
    "---",
    "Throttle the login endpoint.",
    "",
    "## Comments",
    "",
    "### @ben at 2026-09-13 09:00:00 +00:00",
    "",
    "Second pass.",
    "",
    "### @ana at 2026-09-12 10:31:00 +00:00",
    "",
    "First pass.",
  ),
  "list/done/backend/03-fix-login.md": md(
    "---",
    "title: Fix login",
    "group: Backend",
    "completed_at: 2026-09-12T10:31:00Z",
    "---",
  ),
  "list/done/04-drop-ie.md": md(
    "---",
    "title: Drop IE",
    "outcome: cancelled",
    "cancelled_reason: nobody uses it",
    "completed_at: 2026-09-14T08:00:00Z",
    "---",
  ),
}

/** The fs list's open and done tasks, read through its TodoStore. */
const snapshot = Effect.gen(function* () {
  const store = yield* TodoStore

  return { list: yield* store.load(), done: yield* store.listDone() }
})

const fsAt = (root: string) =>
  FsTodoStore.layer({ root: `${root}/list` }).pipe(Layer.provide(BunServices.layer))

const sqliteAt = (root: string, title = "unused") =>
  SqliteTodoStore.layer({ path: `${root}/todo.db`, title }).pipe(
    Layer.provide(BunSqliteDriver.layer),
  )

describe("importList", () => {
  effectTest(
    "copies an fs list with its IDs, groups, order, comments and done tasks",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const from = yield* snapshot.pipe(Effect.provide(fsAt(root)))
      const counts = yield* importList({ path: `${root}/todo.db`, title: "unused" }, from).pipe(
        Effect.provide(BunSqliteDriver.layer),
      )

      expect(counts).toEqual({ open: 3, done: 3 })
      expect(from.list.ungrouped.map((t) => t.id)).toEqual(["1"])
      expect(
        from.list.groups.map((g) => [g.name, g.description, g.tasks.map((t) => t.id)]),
      ).toEqual([
        ["Backend", "Server work.", ["7", "2"]],
        ["Empty", "", []],
      ])
      expect(from.done.map((t) => t.id)).toEqual(["5", "4", "3"])
      expect(from.list.groups[0]?.tasks[1]?.comments.map((c) => c.body)).toEqual([
        "Second pass.",
        "First pass.",
      ])

      const copied = yield* snapshot.pipe(Effect.provide(sqliteAt(root)))

      expect(copied).toEqual(from)

      const next = yield* Effect.flatMap(TodoStore, (s) => s.add({ title: "Next" })).pipe(
        Effect.provide(sqliteAt(root)),
      )

      expect(next.id).toBe("8")
    }),
    diskWith(list),
  )

  effectTest(
    "refuses a database that already holds tasks",
    Effect.gen(function* () {
      const { root } = yield* Disk

      yield* Effect.flatMap(TodoStore, (s) => s.add({ title: "Already here" })).pipe(
        Effect.provide(sqliteAt(root)),
      )

      const from = yield* snapshot.pipe(Effect.provide(fsAt(root)))
      const error = yield* importList({ path: `${root}/todo.db`, title: "unused" }, from).pipe(
        Effect.provide(BunSqliteDriver.layer),
        Effect.flip,
      )

      expect(error.message).toBe(
        root + "/todo.db already holds a list; import fills only an empty one",
      )
      expect(
        (yield* snapshot.pipe(Effect.provide(sqliteAt(root)))).list.ungrouped.map((t) => t.title),
      ).toEqual(["Already here"])
    }),
    diskWith(list),
  )
})
