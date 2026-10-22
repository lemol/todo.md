import { describe, expect } from "bun:test"
import { Effect } from "effect"
import {
  type InvalidTransition,
  type StoreError,
  type TaskNotFound,
  TodoStore,
  type ValidationError,
} from "../../src/spec/index.ts"
import { effectTest, failsWith } from "../../src/spec/testing.ts"
import { Disk, listWith, md } from "./helpers.ts"

const todo = md("# T", "", "## Later", "", "- [ ] [01 - Bad](./later/1-bad.md)")
const alias = "Unresolved alias (the anchor must be set before the alias): a"

const shapes = [
  ["a flow map with an unresolved alias", ["{title: Bad, x: *a}"], alias],
  [
    "YAML with a syntax error",
    ["title: Bad", "x: ["],
    "Flow sequence in block collection must be sufficiently indented and end with a ] at line 3, column 5",
  ],
  ["a sequence", ["- a", "- b"], "frontmatter must be a mapping"],
  ["a scalar", ["hello"], "frontmatter must be a mapping"],
] as const

/** Every file on disk and its text, to compare before and after a write. */
const files = Effect.gen(function* () {
  const disk = yield* Disk

  return yield* Effect.forEach(yield* disk.tree(), (path) =>
    Effect.map(disk.read(path), (text) => [path, text] as const),
  )
})

describe.each(shapes)("frontmatter that is %s", (_shape, yaml, message) => {
  const task = md("---", ...yaml, "---", "Body")

  const list = () => listWith({ "TODO.md": todo, "later/1-bad.md": task })

  const cannotEdit = `cannot edit later/1-bad.md: invalid-frontmatter: ${message}`

  effectTest(
    "fails update, complete and cancel and leaves every file as it was",
    Effect.gen(function* () {
      const store = yield* TodoStore
      const before = yield* files

      for (const write of [
        store.update("1", { assignee: "y" }),
        store.update("1", { title: "Renamed" }),
        store.complete("1"),
        store.cancel("1", "no longer needed"),
      ] as Array<
        Effect.Effect<unknown, InvalidTransition | StoreError | TaskNotFound | ValidationError>
      >) {
        expect((yield* failsWith(write, "StoreError")).message).toBe(cannotEdit)
        expect(yield* files).toEqual(before)
      }
    }),
    list(),
  )

  effectTest(
    "still takes writes that leave the frontmatter alone",
    Effect.gen(function* () {
      const store = yield* TodoStore
      const disk = yield* Disk

      yield* store.update("1", { description: "New" })
      expect(yield* disk.read("later/1-bad.md")).toBe(md("---", ...yaml, "---", "New"))

      yield* store.comment("1", { author: "lemol", body: "Noted." })
      expect(yield* disk.read("later/1-bad.md")).toStartWith(
        md("---", ...yaml, "---", "New", "", "## Comments"),
      )
    }),
    list(),
  )
})

describe("a done file whose frontmatter cannot be edited", () => {
  const done = md("---", "{title: Bad, x: *a}", "---", "Body")

  const list = () => listWith({ "TODO.md": md("# T"), "done/01-bad.md": done })

  effectTest(
    "fails reopen and update and leaves every file as it was",
    Effect.gen(function* () {
      const store = yield* TodoStore
      const before = yield* files

      for (const write of [store.reopen("1"), store.update("1", { assignee: "y" })] as Array<
        Effect.Effect<unknown, InvalidTransition | StoreError | TaskNotFound | ValidationError>
      >) {
        expect((yield* failsWith(write, "StoreError")).message).toBe(
          `cannot edit done/01-bad.md: invalid-frontmatter: ${alias}`,
        )
        expect(yield* files).toEqual(before)
      }
    }),
    list(),
  )
})

effectTest(
  "a block map with an unresolved alias still takes a spliced edit",
  Effect.gen(function* () {
    const disk = yield* Disk

    yield* (yield* TodoStore).update("1", { assignee: "y" })
    expect(yield* disk.read("later/1-bad.md")).toBe(
      md("---", "title: T", "x: *a", "assignee: y", "---", "Body"),
    )
  }),
  listWith({ "TODO.md": todo, "later/1-bad.md": md("---", "title: T", "x: *a", "---", "Body") }),
)
