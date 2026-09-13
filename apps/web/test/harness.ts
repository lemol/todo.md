import { Layer, ManagedRuntime } from "effect"
import { MemoryTodoStore } from "@lemol/todo-md/spec"
import { allCapabilities } from "@lemol/todo-md/spec"
import { TodoService } from "@lemol/todo-md/core"
import { createAppRouter } from "../app/router.ts"
import { makeFakeChanges } from "../app/middleware/changes.ts"

export const makeRuntime = () => {
  const store = MemoryTodoStore.layer({ title: "Acme", description: "Ship deliberately." })
  return ManagedRuntime.make(TodoService.layer.pipe(Layer.provide(store)))
}

export const makeRouter = () => {
  const runtime = makeRuntime()
  return createAppRouter({
    runtime,
    capabilities: allCapabilities,
    changes: makeFakeChanges(),
    author: "tester",
    hosts: ["localhost", "127.0.0.1", "::1"],
    sessionSecret: "test-secret-at-least-32-characters",
  })
}
