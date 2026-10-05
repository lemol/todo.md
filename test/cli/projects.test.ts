import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { fsSource, SyncError } from "../../src/hub/index.ts"
import { memorySource } from "../../src/hub/testing.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, diskWith, md } from "../fs/helpers.ts"
import { lines } from "./fixtures.ts"
import { runTodo } from "./harness.ts"

const alpha = {
  "a/TODO.md": md("# Alpha", "", "- [ ] 01 - First", "- [ ] 02 - Second", "- [ ] 03 - Third"),
  "b/TODO.md": md("# Beta", "", "- [ ] 01 - Uno", "- [ ] 02 - Dos"),
  "empty/.keep": "",
}

/** Registers `a` in a shared home and returns it. */
const withAlpha = (home: string) => runTodo(["projects", "add", "a"], { home })

describe("todo projects", () => {
  effectTest(
    "registers directories, lists them, and renames and removes them",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const home = `${root}/home`

      const added = yield* runTodo(["projects", "add", "a"], { home })
      expect(added.code).toBe(0)
      expect(added.stdout).toBe(`a  fs  ${root}/a  3 open · 3 ready  never synced`)

      const named = yield* runTodo(["projects", "add", "b", "--name", "bee"], { home })
      expect(named.code).toBe(0)
      expect(named.stdout).toBe(`bee  fs  ${root}/b  2 open · 2 ready  never synced`)

      const listed = yield* runTodo(["projects"], { home })
      expect(listed.code).toBe(0)
      expect(listed.stdout).toBe(
        lines(
          `a  fs  ${root}/a  3 open · 3 ready  never synced`,
          `bee  fs  ${root}/b  2 open · 2 ready  never synced`,
        ),
      )
      const json = JSON.parse((yield* runTodo(["projects", "--json"], { home })).stdout)
      expect(json.map((info: { name: string }) => info.name)).toEqual(["a", "bee"])

      const duplicate = yield* runTodo(["projects", "add", "a"], { home })
      expect(duplicate.code).toBe(1)
      expect(duplicate.stderr).toContain("already exists")

      const renamed = yield* runTodo(["projects", "rename", "bee", "beta"], { home })
      expect(renamed.code).toBe(0)
      expect(renamed.stdout).toBe(`beta  fs  ${root}/b  2 open · 2 ready  never synced`)

      const removed = yield* runTodo(["projects", "rm", "beta"], { home })
      expect(removed).toEqual({ code: 0, stdout: "Removed project beta", stderr: "" })

      const gone = yield* runTodo(["projects", "rm", "beta"], { home })
      expect(gone.code).toBe(1)
      expect(gone.stderr).toBe("error: no project named beta")

      expect(yield* (yield* Disk).read("home/projects.yaml")).toContain("a:")
    }),
    diskWith(alpha),
  )

  effectTest(
    "marks the unregistered current project",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const home = `${root}/home`
      const listed = yield* runTodo(["projects"], { home, cwd: "a" })
      expect(listed.code).toBe(0)
      expect(listed.stdout).toBe(
        `a (not registered)  fs  ${root}/a  3 open · 3 ready  never synced`,
      )
    }),
    diskWith(alpha),
  )
})

describe("todo --project and qualified references", () => {
  effectTest(
    "runs commands on another project from an unrelated directory",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const home = `${root}/home`
      yield* withAlpha(home)

      const listed = yield* runTodo(["--project", "a", "ls"], { home, cwd: "empty" })
      expect(listed.code).toBe(0)
      expect(listed.stdout).toContain("First")

      const done = yield* runTodo(["done", "a:03"], { home, cwd: "empty" })
      expect(done.code).toBe(0)
      expect(done.stdout).toContain("Done 03  Third")

      const clash = yield* runTodo(["--project", "a", "show", "b:01"], { home, cwd: "empty" })
      expect(clash.code).toBe(2)

      const both = yield* runTodo(["--project", "a", "--dir", "a", "ls"], { home, cwd: "empty" })
      expect(both).toEqual({
        code: 2,
        stdout: "",
        stderr: "error: use --project or --dir, not both",
      })
    }),
    diskWith(alpha),
  )

  effectTest(
    "shows the registered project name in JSON, and none when unregistered",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const home = `${root}/home`
      yield* withAlpha(home)

      const registered = yield* runTodo(["ls", "--json"], { home, cwd: "a" })
      expect(JSON.parse(registered.stdout).project).toBe("a")

      const bare = yield* runTodo(["ls", "--json"], { home: `${root}/other-home`, cwd: "a" })
      expect("project" in JSON.parse(bare.stdout)).toBe(false)
    }),
    diskWith(alpha),
  )
})

describe("todo ls --all and next --all", () => {
  effectTest(
    "shows every project, with an error entry for the broken one",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const home = `${root}/home`
      yield* withAlpha(home)
      yield* runTodo(["projects", "add", "./ghost"], { home })

      const all = yield* runTodo(["ls", "--all"], { home, cwd: "empty" })
      expect(all.code).toBe(0)
      expect(all.stdout).toBe(
        lines(
          "# a",
          "Alpha",
          "",
          "  a:01  First",
          "  a:02  Second",
          "  a:03  Third",
          "",
          "3 open · 3 ready · 0 blocked",
          "",
          "# ghost",
          `error: no TODO.md at ${root}/ghost`,
        ),
      )

      const next = yield* runTodo(["next", "--all"], { home, cwd: "empty" })
      expect(next.code).toBe(0)
      expect(next.stdout).toContain("# a")
      expect(next.stdout).toContain("a:01  First")
      expect(next.stdout).toContain(`# ghost\nerror: no TODO.md at ${root}/ghost`)

      const view = JSON.parse(
        (yield* runTodo(["ls", "--all", "--json"], { home, cwd: "empty" })).stdout,
      )

      expect(
        view.projects.map((entry: { project: { name: string } }) => entry.project.name),
      ).toEqual(["a", "ghost"])
      expect("error" in view.projects[1]).toBe(true)
    }),
    diskWith(alpha),
  )
})

describe("todo sync", () => {
  effectTest(
    "syncs nothing for a local list",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const home = `${root}/home`
      yield* withAlpha(home)
      expect(yield* runTodo(["sync"], { home, cwd: "a" })).toEqual({
        code: 0,
        stdout: "a: nothing to sync",
        stderr: "",
      })
    }),
    diskWith(alpha),
  )

  effectTest(
    "reports a failed sync and exits 1",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const home = `${root}/home`
      const sources = [
        fsSource,
        memorySource({
          sync: () =>
            Effect.fail(new SyncError({ project: "mem", reason: "auth", message: "bad token" })),
        }),
      ]

      yield* runTodo(["projects", "add", "x", "--source", "memory", "--name", "mem"], {
        home,
        sources,
      })

      const synced = yield* runTodo(["sync", "mem"], { home, sources })
      expect(synced.code).toBe(1)
      expect(synced.stdout).toBe("mem: error (auth): bad token")
      expect(synced.stderr).toBe("error: sync failed for 1 project")

      const all = yield* runTodo(["sync", "--all", "--json"], { home, sources })
      expect(all.code).toBe(1)
      const outcomes = JSON.parse(all.stdout)
      expect(outcomes).toHaveLength(1)
      expect(outcomes[0].project).toBe("mem")
    }),
    diskWith(alpha),
  )

  effectTest(
    "warns after a mutation when the project is ahead or diverged",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const home = `${root}/home`
      const sources = [
        fsSource,
        memorySource({
          sync: () => Effect.succeed({ summary: "ok" }),
          status: () => Effect.succeed({ ahead: 1, error: "offline" }),
        }),
        memorySource({
          kind: "memory2",
          sync: () => Effect.succeed({ summary: "ok" }),
          status: () => Effect.succeed({ diverged: true }),
        }),
      ]

      yield* withAlpha(home)
      yield* runTodo(["projects", "add", "x", "--source", "memory", "--name", "mem"], {
        home,
        sources,
      })
      yield* runTodo(["projects", "add", "x", "--source", "memory2", "--name", "memd"], {
        home,
        sources,
      })

      const added = yield* runTodo(["add", "--project", "mem", "Do", "it", "--quick"], {
        home,
        sources,
      })

      expect(added.code).toBe(0)
      expect(added.stdout).toBe("Added 01  Do it")
      expect(added.stderr).toBe("todo: not pushed (ahead 1): offline")

      const other = yield* runTodo(["add", "--project", "memd", "Do", "it", "--quick"], {
        home,
        sources,
      })

      expect(other.code).toBe(0)
      expect(other.stderr).toBe("todo: memd has diverged; resolve it in memory")

      const local = yield* runTodo(["add", "--project", "a", "Do", "it", "--quick"], {
        home,
        sources,
      })

      expect(local).toEqual({ code: 0, stdout: "Added 04  Do it", stderr: "" })
    }),
    diskWith(alpha),
  )
})
