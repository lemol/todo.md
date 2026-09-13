import { TodoService } from "@lemol/todo-md/core"
import { allCapabilities, MemoryTodoStore } from "@lemol/todo-md/spec"
import { Layer, ManagedRuntime } from "effect"
import type { AppAssets } from "../app/assets.ts"
import { makeFakeChanges } from "../app/middleware/changes.ts"
import { createAppRouter } from "../app/router.ts"

export const makeRuntime = () => {
  const store = MemoryTodoStore.layer({ title: "Acme", description: "Ship deliberately." })
  return ManagedRuntime.make(TodoService.layer.pipe(Layer.provide(store)))
}

export const makeFakeAssets = (): AppAssets => ({
  getScriptEntry: async (path) => ({
    href: `/assets/${path}`,
    importMap: { imports: {}, scopes: {} },
    preloads: [],
  }),
  fetch: async () => null,
  close: async () => undefined,
})

export const makeRouter = () => {
  const runtime = makeRuntime()
  return createAppRouter({
    runtime,
    capabilities: allCapabilities,
    changes: makeFakeChanges(),
    author: "tester",
    hosts: ["localhost", "127.0.0.1", "::1"],
    sessionSecret: "test-secret-at-least-32-characters",
    assets: makeFakeAssets(),
  })
}
