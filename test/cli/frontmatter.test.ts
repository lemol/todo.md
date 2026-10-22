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
    "Flow sequence in block collection must be sufficiently indented and end with a ] at line 2, column 5:",
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
