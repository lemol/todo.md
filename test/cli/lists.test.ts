import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, diskWith, md } from "../fs/helpers.ts"
import { runTodo, todo } from "./harness.ts"

describe("todo init", () => {
  effectTest(
    "creates ./todo/TODO.md titled after the working directory",
    Effect.gen(function* () {
      const disk = yield* Disk

      yield* disk.write("acme/README.md", "")
      const result = yield* runTodo(["init"], { cwd: "acme" })

      expect(result).toEqual({ code: 0, stdout: "Created todo/TODO.md", stderr: "" })
      expect(yield* disk.read("acme/todo/TODO.md")).toBe(md("# acme"))
    }),
    diskWith({}),
  )

  effectTest(
    "takes a directory and a title, and prints JSON with --json",
    Effect.gen(function* () {
      const disk = yield* Disk
      const result = yield* todo("init", "docs/tasks", "--title", "Acme API", "--json")

      expect(result.code).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({ root: `${disk.root}/docs/tasks` })
      expect(yield* disk.read("docs/tasks/TODO.md")).toBe(md("# Acme API"))
    }),
    diskWith({}),
  )

  effectTest(
    "refuses a directory that already has a list",
    Effect.gen(function* () {
      const result = yield* todo("init", ".")

      expect(result.code).toBe(1)
      expect(result.stderr).toContain("error: ")
      expect(result.stderr).toContain("already has a TODO.md")
    }),
    diskWith({ "TODO.md": md("# T") }),
  )
})

describe("todo fmt", () => {
  effectTest(
    "normalizes the list and says what it did",
    Effect.gen(function* () {
      const first = yield* todo("fmt")

      expect(first).toEqual({
        code: 0,
        stdout: "Numbered 1 task, completed 1 checked task.",
        stderr: "",
      })
      expect((yield* todo("fmt")).stdout).toBe("Nothing to normalize.")
      expect(JSON.parse((yield* todo("fmt", "--json")).stdout)).toEqual({
        assigned: [],
        finished: [],
        swept: [],
      })
    }),
    diskWith({ "TODO.md": md("# T", "", "- [ ] Buy milk", "- [x] 01 - Done by hand") }),
  )
})

describe("finding the list, errors and exit codes", () => {
  effectTest(
    "finds the list from a subdirectory, and uses --dir when given",
    Effect.gen(function* () {
      expect((yield* runTodo(["fmt"], { cwd: "src/deep" })).code).toBe(0)
      expect((yield* runTodo(["fmt", "--dir", "../.."], { cwd: "src/deep" })).code).toBe(0)
    }),
    diskWith({ "TODO.md": md("# T"), "src/deep/file.ts": "" }),
  )

  effectTest(
    "fails with exit 1 and a message when there is no list",
    Effect.gen(function* () {
      const result = yield* todo("fmt")

      expect(result.code).toBe(1)
      expect(result.stdout).toBe("")
      expect(result.stderr).toMatch(
        /^error: no todo\.md list found from .*; run `todo init` or pass --dir$/,
      )
      const json = yield* todo("fmt", "--json")

      expect(json.code).toBe(1)
      expect(JSON.parse(json.stderr)).toMatchObject({ error: { tag: "NoListFound" } })
    }),
    diskWith({}),
  )

  effectTest(
    "fails with exit 2 on a usage error, and exits 0 for --help",
    Effect.gen(function* () {
      const unknown = yield* todo("frobnicate")

      expect(unknown.code).toBe(2)
      expect(unknown.stderr).toContain('Unknown subcommand "frobnicate"')
      const help = yield* todo("--help")

      expect(help.code).toBe(0)
      expect(help.stdout).toContain("USAGE")
    }),
    diskWith({}),
  )

  effectTest(
    "prints the version with --version",
    Effect.gen(function* () {
      const result = yield* todo("--version")

      expect(result.code).toBe(0)
      expect(result.stdout).toContain("0.2.0")
    }),
    diskWith({}),
  )
})
