import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, diskWith, md } from "../fs/helpers.ts"
import { todo } from "./harness.ts"

const list = md("# T", "", "## Later", "", "- [ ] [01 - Bad](./later/1-bad.md)")

describe.each([
  [["{title: Bad, x: *a}"], "Unresolved alias (the anchor must be set before the alias): a"],
  [
    ["title: Bad", "x: ["],
    "Flow sequence in block collection must be sufficiently indented and end with a ] at line 3, column 5",
  ],
] as const)("a task whose frontmatter is %j", (yaml, message) => {
  const task = md("---", ...yaml, "---", "Body")

  effectTest(
    "edit, done and cancel fail, name the file and change nothing",
    Effect.gen(function* () {
      const disk = yield* Disk

      for (const args of [
        ["edit", "1", "--assignee", "y"],
        ["done", "1"],
        ["cancel", "1", "--reason", "no longer needed"],
      ]) {
        expect(yield* todo(...args)).toEqual({
          code: 1,
          stdout: "",
          stderr: `error: cannot edit later/1-bad.md: invalid-frontmatter: ${message}`,
        })
        expect(yield* disk.read("TODO.md")).toBe(list)
        expect(yield* disk.read("later/1-bad.md")).toBe(task)
        expect(yield* disk.tree()).toEqual(["TODO.md", "later/1-bad.md"])
      }
    }),
    diskWith({ "TODO.md": list, "later/1-bad.md": task }),
  )
})

effectTest(
  "edit still splices a block map whose alias does not resolve",
  Effect.gen(function* () {
    const disk = yield* Disk

    expect((yield* todo("edit", "1", "--assignee", "y")).code).toBe(0)
    expect(yield* disk.read("later/1-bad.md")).toBe(
      md("---", "title: T", "x: *a", "assignee: y", "---", "Body"),
    )
  }),
  diskWith({ "TODO.md": list, "later/1-bad.md": md("---", "title: T", "x: *a", "---", "Body") }),
)

effectTest(
  "check and edit agree on the syntax error's file line",
  Effect.gen(function* () {
    expect(yield* todo("check")).toEqual({
      code: 1,
      stdout:
        "error    later/2-syn.md:3  invalid-frontmatter  Flow sequence in block collection must be sufficiently indented and end with a ] at line 3, column 5\n\n1 error",
      stderr: "",
    })
    expect(yield* todo("edit", "2", "--assignee", "y")).toEqual({
      code: 1,
      stdout: "",
      stderr:
        "error: cannot edit later/2-syn.md: invalid-frontmatter: Flow sequence in block collection must be sufficiently indented and end with a ] at line 3, column 5",
    })
    const disk = yield* Disk

    expect(yield* disk.read("later/2-syn.md")).toBe(md("---", "title: Syn", "x: [", "---", "Body"))
    expect(yield* disk.read("TODO.md")).toBe(
      md("# T", "", "## Later", "", "- [ ] [02 - Syn](./later/2-syn.md)"),
    )
    expect(yield* disk.tree()).toEqual(["TODO.md", "later/2-syn.md"])
  }),
  diskWith({
    "TODO.md": md("# T", "", "## Later", "", "- [ ] [02 - Syn](./later/2-syn.md)"),
    "later/2-syn.md": md("---", "title: Syn", "x: [", "---", "Body"),
  }),
)

effectTest(
  "reopen reports a done file's syntax error without changing it",
  Effect.gen(function* () {
    expect(yield* todo("reopen", "2")).toEqual({
      code: 1,
      stdout: "",
      stderr:
        "error: cannot edit done/02-syn.md: invalid-frontmatter: Flow sequence in block collection must be sufficiently indented and end with a ] at line 3, column 5",
    })
    const disk = yield* Disk

    expect(yield* disk.read("TODO.md")).toBe(md("# T"))
    expect(yield* disk.read("done/02-syn.md")).toBe(md("---", "title: Syn", "x: [", "---", "Body"))
    expect(yield* disk.tree()).toEqual(["TODO.md", "done/02-syn.md"])
  }),
  diskWith({
    "TODO.md": md("# T"),
    "done/02-syn.md": md("---", "title: Syn", "x: [", "---", "Body"),
  }),
)
