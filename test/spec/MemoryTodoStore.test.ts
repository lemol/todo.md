import { describe, expect } from "bun:test"
import { Effect } from "effect"
import * as MemoryTodoStore from "../../src/spec/MemoryTodoStore.ts"
import { allCapabilities, TodoStore } from "../../src/spec/TodoStore.ts"
import { effectTest, runConformance } from "../../src/spec/testing.ts"

runConformance("MemoryTodoStore", MemoryTodoStore.layer())

describe("MemoryTodoStore", () => {
  effectTest(
    "starts with the given title and description",
    Effect.gen(function* () {
      const list = yield* (yield* TodoStore).load()
      expect(list.title).toBe("Acme API")
      expect(list.description).toBe("Backlog for the Acme public API.")
    }),
    MemoryTodoStore.layer({ title: "Acme API", description: "Backlog for the Acme public API." }),
  )

  effectTest(
    "supports every capability and reports no diagnostics",
    Effect.gen(function* () {
      const store = yield* TodoStore
      expect(store.capabilities).toEqual(allCapabilities)
      expect(yield* store.diagnostics()).toEqual([])
    }),
    MemoryTodoStore.layer(),
  )
})
