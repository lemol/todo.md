import { describe, expect } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { memorySource } from "../../src/hub/testing.ts"
import { TodoStore } from "../../src/spec/index.ts"
import { effectTest } from "../../src/spec/testing.ts"

/** Opens `name` from `source` and returns its store, or the open failure. */
const open = (source: ReturnType<typeof memorySource>, name: string, config = {}) =>
  TodoStore.pipe(
    Effect.provide(source.open({ name, config, dir: undefined })),
    Effect.provide(BunServices.layer),
  )

describe("memorySource", () => {
  effectTest(
    "seeds a store from its config on first open",
    Effect.gen(function* () {
      const store = yield* open(memorySource(), "m", { title: "M", tasks: [{ title: "One" }] })
      const list = yield* store.load()
      expect(list.title).toBe("M")
      expect(list.ungrouped.map((task) => task.title)).toEqual(["One"])
    }),
  )

  effectTest(
    "keeps each project's store across opens, per source value",
    Effect.gen(function* () {
      const source = memorySource()
      yield* (yield* open(source, "a")).add({ title: "Kept" })
      expect((yield* (yield* open(source, "a")).load()).ungrouped).toHaveLength(1)
      expect((yield* (yield* open(source, "b")).load()).ungrouped).toHaveLength(0)
      expect((yield* (yield* open(memorySource(), "a")).load()).ungrouped).toHaveLength(0)
    }),
  )

  effectTest(
    "fails with SourceError when a seed task is invalid",
    Effect.gen(function* () {
      const tasks = [{ title: "Self", dependsOn: ["1"] }]
      const error = yield* Effect.flip(open(memorySource(), "m", { tasks }))
      expect(error).toMatchObject({ _tag: "SourceError", name: "m" })
    }),
  )

  effectTest(
    "adds the hooks it is given",
    Effect.sync(() => {
      const source = memorySource({ defaultName: () => "memo" })
      expect(source.kind).toBe("memory")
      expect(source.defaultName?.({})).toBe("memo")
      expect(source.sync).toBeUndefined()
    }),
  )
})
