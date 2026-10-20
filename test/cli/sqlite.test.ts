import { describe, expect } from "bun:test"
import { Effect } from "effect"
import * as BunSqliteDriver from "../../src/cli/BunSqliteDriver.ts"
import { fsSource } from "../../src/hub/index.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { SqliteSource } from "../../src/sqlite/index.ts"
import { Disk, diskWith, md } from "../fs/helpers.ts"
import { runTodo } from "./harness.ts"

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
})
