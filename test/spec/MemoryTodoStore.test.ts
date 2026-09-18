import { describe, expect } from "bun:test"
import { Effect } from "effect"
import * as MemoryTodoStore from "../../src/spec/MemoryTodoStore.ts"
import { allCapabilities, TodoStore } from "../../src/spec/TodoStore.ts"
import { effectTest, runConformance } from "../../src/spec/testing.ts"

runConformance("MemoryTodoStore", MemoryTodoStore.layer())
runConformance("MemoryTodoStore without cancel", MemoryTodoStore.layer({ cancel: false }))

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
    "supports every capability but promotion, and reports no diagnostics",
    Effect.gen(function* () {
      const store = yield* TodoStore
      // It has no documents to promote a task's detail into (spec §1.5).
      expect(store.capabilities).toEqual({ ...allCapabilities, promote: false })
      expect(yield* store.diagnostics()).toEqual([])
    }),
    MemoryTodoStore.layer(),
  )

  effectTest(
    "cancel records the outcome and the reason, and reopen clears both",
    Effect.gen(function* () {
      const store = yield* TodoStore
      const task = yield* store.add({ title: "Register apps/* in the workspace" })
      const cancelled = yield* store.cancel(task.id, "Superseded: there is no apps/ directory.")
      expect(cancelled.status).toBe("done")
      expect(cancelled.outcome).toBe("cancelled")
      expect(cancelled.cancelledReason).toBe("Superseded: there is no apps/ directory.")
      expect(cancelled.completedAt).toBeDefined()

      const reopened = yield* store.reopen(task.id)
      expect(reopened.status).toBe("open")
      expect(reopened.outcome).toBeUndefined()
      expect(reopened.cancelledReason).toBeUndefined()
      expect(reopened.completedAt).toBeUndefined()
    }),
    MemoryTodoStore.layer(),
  )
})
