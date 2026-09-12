import { describe, expect } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Effect, Option } from "effect"
import { findListRoot, initList } from "../../src/fs/index.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, diskWith, listWith, md } from "./helpers.ts"

const find = (cwd: string) => findListRoot(cwd).pipe(Effect.provide(BunServices.layer))

describe("findListRoot", () => {
  effectTest(
    "prefers todo/TODO.md over TODO.md at the same level, walking up from below",
    Effect.gen(function* () {
      const { root } = yield* Disk
      expect(yield* find(`${root}/src/deep`)).toEqual(Option.some(`${root}/todo`))
      expect(yield* find(`${root}/todo`)).toEqual(Option.some(`${root}/todo`))
    }),
    listWith({ "TODO.md": md("# Root"), "todo/TODO.md": md("# Project"), "src/deep/file.ts": "" }),
  )

  effectTest(
    "finds TODO.md at the root when there is no todo/ directory",
    Effect.gen(function* () {
      const { root } = yield* Disk
      expect(yield* find(`${root}/src`)).toEqual(Option.some(root))
    }),
    listWith({ "TODO.md": md("# Root"), "src/file.ts": "" }),
  )

  effectTest(
    "returns Option.none() when no list exists",
    Effect.gen(function* () {
      const { root } = yield* Disk
      expect(yield* find(root)).toEqual(Option.none())
    }),
    diskWith({ "src/file.ts": "" }),
  )
})

describe("initList", () => {
  effectTest(
    "creates the directory and a TODO.md with the title",
    Effect.gen(function* () {
      const disk = yield* Disk
      yield* initList(`${disk.root}/new/todo`, { title: "New", description: "Backlog." }).pipe(
        Effect.provide(BunServices.layer),
      )
      expect(yield* disk.read("new/todo/TODO.md")).toBe(md("# New", "", "Backlog."))
    }),
    listWith({ "TODO.md": md("# Root") }),
  )

  effectTest(
    "refuses a directory that already has a TODO.md",
    Effect.gen(function* () {
      const disk = yield* Disk
      const error = yield* Effect.flip(
        initList(disk.root, { title: "Again" }).pipe(Effect.provide(BunServices.layer)),
      )
      expect(error.message).toContain("already has a TODO.md")
      expect(yield* disk.read("TODO.md")).toBe(md("# Root"))
    }),
    listWith({ "TODO.md": md("# Root") }),
  )
})
