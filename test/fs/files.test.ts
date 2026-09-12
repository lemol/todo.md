import { expect } from "bun:test"
import { Effect } from "effect"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, diskWith, filesOnDisk, md } from "./helpers.ts"

effectTest(
  "read returns a file's text, or undefined when it is missing",
  Effect.gen(function* () {
    const files = yield* filesOnDisk
    expect(yield* files.read("TODO.md")).toBe(md("# T"))
    expect(yield* files.read("missing.md")).toBeUndefined()
  }),
  diskWith({ "TODO.md": md("# T") }),
)

effectTest(
  "write creates directories and leaves no temporary file behind",
  Effect.gen(function* () {
    const files = yield* filesOnDisk
    yield* files.write("done/backend/01-a.md", "text\n")
    yield* files.write("done/backend/01-a.md", "new text\n")
    const disk = yield* Disk
    expect(yield* disk.tree()).toEqual(["done/backend/01-a.md"])
    expect(yield* disk.read("done/backend/01-a.md")).toBe("new text\n")
  }),
  diskWith({}),
)

effectTest(
  "write cleans up temporary files if rename fails and maps error to StoreError",
  Effect.gen(function* () {
    const files = yield* filesOnDisk
    const disk = yield* Disk
    yield* files.write("dir/file.txt", "content\n")
    const error = yield* Effect.flip(files.write("dir", "fail\n"))
    expect(error._tag).toBe("StoreError")
    expect(error.message).toContain("could not write dir")
    const tree = yield* disk.tree()
    expect(tree).toEqual(["dir/file.txt"])
    expect(tree.some((f) => f.endsWith(".tmp"))).toBe(false)
  }),
  diskWith({}),
)

effectTest(
  "remove ignores missing files, and move creates the target's directories",
  Effect.gen(function* () {
    const files = yield* filesOnDisk
    yield* files.remove("missing.md")
    yield* files.move("01-a.md", "backend/01-a.md")
    expect(yield* (yield* Disk).tree()).toEqual(["backend/01-a.md"])
    expect(yield* files.exists("01-a.md")).toBe(false)
    expect(yield* files.exists("backend/01-a.md")).toBe(true)
  }),
  diskWith({ "01-a.md": "a\n" }),
)

effectTest(
  "list returns root-relative paths, recursively when asked, and nothing for a missing directory",
  Effect.gen(function* () {
    const files = yield* filesOnDisk
    expect(yield* files.list(".")).toEqual(["01-a.md", "TODO.md", "done"])
    expect(yield* files.list("done", { recursive: true })).toEqual([
      "done/backend",
      "done/backend/02-b.md",
    ])
    expect(yield* files.list("missing")).toEqual([])
  }),
  diskWith({ "TODO.md": md("# T"), "01-a.md": "a\n", "done/backend/02-b.md": "b\n" }),
)
