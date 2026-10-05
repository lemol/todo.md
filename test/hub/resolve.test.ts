import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { fsSource } from "../../src/hub/index.ts"
import { memorySource } from "../../src/hub/testing.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, diskWith, hubOn, md } from "./helpers.ts"

const lists = {
  "app/todo/TODO.md": md("# App"),
  "app/src/index.ts": "",
  "work/app/TODO.md": md("# Work app"),
  "other/My Tool/TODO.md": md("# Tool"),
  "empty/file.ts": "",
}

describe("resolve", () => {
  effectTest(
    "project wins over dir, and an unknown project fails",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const hub = yield* hubOn([fsSource, memorySource()])

      yield* hub.add({ name: "m", source: "memory", config: {} })
      const info = yield* hub.resolve({ project: "m", dir: "work/app", cwd: root })

      expect(info).toMatchObject({ name: "m", source: "memory", registered: true })
      const error = yield* Effect.flip(hub.resolve({ project: "nope", cwd: root }))

      expect(error).toMatchObject({ _tag: "ProjectNotFound", name: "nope" })
    }),
    diskWith(lists),
  )

  effectTest(
    "dir opens an unregistered fs project over that list",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const hub = yield* hubOn([fsSource])
      const info = yield* hub.resolve({ dir: "app", cwd: `${root}/work` })

      expect(info).toEqual({
        name: "app",
        source: "fs",
        location: `${root}/work/app`,
        registered: false,
        syncable: false,
        status: { result: "never" },
      })
      expect((yield* (yield* hub.todo("app")).list()).title).toBe("Work app")
    }),
    diskWith(lists),
  )

  effectTest(
    "discovery inside a registered fs project resolves to it",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const hub = yield* hubOn([fsSource])

      yield* hub.add({ name: "main", source: "fs", config: { path: `${root}/app` } })
      const info = yield* hub.resolve({ cwd: `${root}/app/src` })

      expect(info).toMatchObject({ name: "main", registered: true })
    }),
    diskWith(lists),
  )

  effectTest(
    "an unregistered list is named after its project directory, with a suffix when taken",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const hub = yield* hubOn([fsSource, memorySource()])

      yield* hub.add({ name: "app", source: "memory", config: {} })
      const first = yield* hub.resolve({ cwd: `${root}/app/src` })

      expect(first).toMatchObject({
        name: "app-2",
        registered: false,
        location: `${root}/app/todo`,
      })
      const second = yield* hub.resolve({ cwd: `${root}/work/app` })

      expect(second.name).toBe("app-3")
      expect((yield* hub.resolve({ cwd: `${root}/app` })).name).toBe("app-2")
      expect((yield* hub.resolve({ cwd: `${root}/other/My Tool` })).name).toBe("my-tool")
      expect((yield* hub.projects()).map((project) => project.name)).toEqual([
        "app",
        "app-2",
        "app-3",
        "my-tool",
      ])
      expect((yield* (yield* hub.todo("app-2")).list()).title).toBe("App")
    }),
    diskWith(lists),
  )

  effectTest(
    "no list fails with NoListFound",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const hub = yield* hubOn([fsSource])
      const error = yield* Effect.flip(hub.resolve({ cwd: `${root}/empty` }))

      expect(error).toMatchObject({ _tag: "NoListFound", cwd: `${root}/empty` })
      expect(error.message).toBe(
        `no todo.md list found from ${root}/empty; run \`todo init\` or pass --dir`,
      )
    }),
    diskWith(lists),
  )

  effectTest(
    "a broken registry does not stop discovery",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const hub = yield* hubOn([fsSource])
      const info = yield* hub.resolve({ cwd: `${root}/app` })

      expect(info).toMatchObject({ name: "app", registered: false })
      expect((yield* (yield* hub.todo("app")).list()).title).toBe("App")
    }),
    diskWith({ ...lists, ".todo-md/projects.yaml": "projects: [\n" }),
  )
})
