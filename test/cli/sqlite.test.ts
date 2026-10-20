import { describe, expect } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Effect, Layer } from "effect"
import * as BunSqliteDriver from "../../src/cli/BunSqliteDriver.ts"
import { FsTodoStore } from "../../src/fs/index.ts"
import { fsSource } from "../../src/hub/index.ts"
import { TodoStore } from "../../src/spec/index.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { SqliteSource, SqliteTodoStore } from "../../src/sqlite/index.ts"
import { Disk, diskWith, md } from "../fs/helpers.ts"
import { runTodo } from "./harness.ts"

/** A store's open and done tasks. */
const snapshot = Effect.gen(function* () {
  const store = yield* TodoStore

  return { list: yield* store.load(), done: yield* store.listDone() }
})

const fsList = (root: string) =>
  snapshot.pipe(Effect.provide(FsTodoStore.layer({ root }).pipe(Layer.provide(BunServices.layer))))

const database = (path: string) =>
  snapshot.pipe(
    Effect.provide(
      SqliteTodoStore.layer({ path, title: "unused" }).pipe(Layer.provide(BunSqliteDriver.layer)),
    ),
  )

const sources = [
  fsSource,
  Effect.runSync(SqliteSource.make().pipe(Effect.provide(BunSqliteDriver.layer))),
]

describe("todo projects add --source sqlite", () => {
  effectTest(
    "registers a database list that the task commands then work on, and removes it",
    Effect.gen(function* () {
      const disk = yield* Disk
      const home = `${disk.root}/home`

      const run = (...args: ReadonlyArray<string>) => runTodo(args, { home, sources })

      const added = yield* run("projects", "add", "groceries", "--source", "sqlite")

      expect(added.code).toBe(0)
      expect(added.stdout).toStartWith("groceries  sqlite  todo.db  0 open")
      expect((yield* run("--project", "groceries", "add", "Buy oat milk", "--quick")).code).toBe(0)
      expect(
        (yield* run("--project", "groceries", "add", "Return the bottles", "--quick")).code,
      ).toBe(0)
      expect((yield* run("--project", "groceries", "done", "1")).code).toBe(0)

      const listed = yield* run("--project", "groceries", "ls")

      expect(listed.stdout).toContain("Return the bottles")
      expect(listed.stdout).not.toContain("Buy oat milk")

      const given = yield* run(
        "projects",
        "add",
        "pantry",
        "--source",
        "sqlite",
        "--path",
        "~/pantry.db",
      )

      expect(given.code).toBe(0)
      expect((yield* run("projects", "rm", "groceries")).code).toBe(0)
      expect((yield* run("projects", "rm", "pantry")).code).toBe(0)
      expect(yield* disk.exists("home/projects/groceries/todo.db")).toBe(false)
      expect(yield* disk.exists("pantry.db")).toBe(true)
    }),
    diskWith({}),
  )

  effectTest(
    "--path is refused for other sources",
    Effect.gen(function* () {
      const refused = yield* runTodo(["projects", "add", "a", "--path", "/srv/a.db"], { sources })

      expect(refused.code).toBe(2)
      expect(refused.stderr).toBe("error: --path is not for fs projects; a is a fs project")
    }),
    diskWith({ "a/TODO.md": md("# Alpha") }),
  )

  effectTest(
    "--from copies a Markdown list into the new database, IDs and all",
    Effect.gen(function* () {
      const disk = yield* Disk
      const home = `${disk.root}/home`

      const run = (...args: ReadonlyArray<string>) => runTodo(args, { home, sources })

      const added = yield* run(
        "projects",
        "add",
        "groceries",
        "--source",
        "sqlite",
        "--from",
        "groceries",
      )

      expect(added.code).toBe(0)
      expect(added.stdout).toStartWith("groceries  sqlite  todo.db  2 open")

      const from = yield* fsList(`${disk.root}/groceries/todo`)

      expect(yield* database(`${home}/projects/groceries/todo.db`)).toEqual(from)
      expect(from.list.groups.map((group) => group.tasks.map((task) => task.id))).toEqual([["7"]])
      expect(from.done.map((task) => task.id)).toEqual(["3"])

      const next = yield* run("--project", "groceries", "add", "Buy bread", "--quick", "--json")

      expect(JSON.parse(next.stdout).id).toBe("8")
    }),
    diskWith({
      "groceries/todo/TODO.md": md(
        "# Groceries",
        "",
        "- [ ] 01 - Buy oat milk",
        "",
        "## Market",
        "",
        "Saturday stalls.",
        "",
        "- [ ] [07 - Find the cheese stall](./market/07-find-the-cheese-stall.md)",
      ),
      "groceries/todo/market/07-find-the-cheese-stall.md": md(
        "---",
        "title: Find the cheese stall",
        "---",
        "",
        "## Comments",
        "",
        "### @ana at 2026-09-12 10:31:00 +00:00",
        "",
        "Near the fountain.",
      ),
      "groceries/todo/done/03-return-the-bottles.md": md(
        "---",
        "title: Return the bottles",
        "completed_at: 2026-09-12T10:31:00Z",
        "---",
      ),
    }),
  )

  effectTest(
    "--from with --path creates the missing directory of the database",
    Effect.gen(function* () {
      const disk = yield* Disk
      const home = `${disk.root}/home`

      const added = yield* runTodo(
        ["projects", "add", "g", "--source", "sqlite", "--path", "~/missing/g.db", "--from", "g"],
        { home, sources },
      )

      expect(added.code).toBe(0)

      const from = yield* fsList(`${disk.root}/g/todo`)

      expect(yield* database(`${disk.root}/missing/g.db`)).toEqual(from)
    }),
    diskWith({ "g/todo/TODO.md": md("# G", "", "- [ ] 01 - One") }),
  )

  effectTest(
    "--from into a database that holds tasks fails and leaves no project behind",
    Effect.gen(function* () {
      const disk = yield* Disk
      const home = `${disk.root}/home`

      const run = (...args: ReadonlyArray<string>) => runTodo(args, { home, sources })

      expect(
        (yield* run("projects", "add", "full", "--source", "sqlite", "--path", "~/full.db")).code,
      ).toBe(0)
      expect((yield* run("--project", "full", "add", "Already here", "--quick")).code).toBe(0)
      expect((yield* run("projects", "rm", "full")).code).toBe(0)

      const refused = yield* run(
        "projects",
        "add",
        "again",
        "--source",
        "sqlite",
        "--path",
        "~/full.db",
        "--from",
        "list",
      )

      expect(refused.code).toBe(1)
      expect(refused.stderr).toBe(
        `error: ${disk.root}/full.db already holds a list; import fills only an empty one`,
      )
      expect((yield* run("projects")).stdout).not.toContain("again")
      expect(
        (yield* database(`${disk.root}/full.db`)).list.ungrouped.map((task) => task.title),
      ).toEqual(["Already here"])
    }),
    diskWith({ "list/TODO.md": md("# List", "", "- [ ] 01 - One") }),
  )

  effectTest(
    "--from is refused for other sources, a directory without a list and a list with errors",
    Effect.gen(function* () {
      const disk = yield* Disk
      const other = yield* runTodo(["projects", "add", "a", "--from", "b"], { sources })

      expect(other.code).toBe(2)
      expect(other.stderr).toBe("error: --from is not for fs projects; a is a fs project")

      const empty = yield* runTodo(["projects", "add", "g", "--source", "sqlite", "--from", "b"], {
        sources,
      })

      expect(empty.code).toBe(2)
      expect(empty.stderr).toBe("error: --from b has no todo.md list")

      const broken = yield* runTodo(["projects", "add", "g", "--source", "sqlite", "--from", "c"], {
        sources,
      })

      expect(broken.code).toBe(2)
      expect(broken.stderr).toBe(
        `error: --from c has 1 error; fix them first (todo check --dir ${disk.root}/c)`,
      )
    }),
    diskWith({
      "a/TODO.md": md("# Alpha"),
      "b/notes.md": md("# Not a list"),
      "c/TODO.md": md("# C", "", "- [ ] [01 - A](./01-a.md)"),
      "c/01-a.md": md("---", "title: A", "---", "## Comments", "", "### a note"),
    }),
  )
})
