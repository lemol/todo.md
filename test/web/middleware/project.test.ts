import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BunServices } from "@effect/platform-bun"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Hub } from "../../../src/hub/index.ts"
import { memorySource } from "../../../src/hub/testing.ts"
import { loadProject } from "../../../src/web/app/middleware/project.tsx"
import {
  authorContext,
  capabilitiesContext,
  projectInfoContext,
  todoRuntimeContext,
} from "../../../src/web/app/middleware/todo.ts"

const makeHubRuntime = () => {
  const home = mkdtempSync(join(tmpdir(), "todo-md-project-mw-"))
  const layer = Hub.layer({
    home,
    userHome: tmpdir(),
    sources: [memorySource()],
  }).pipe(Layer.provide(BunServices.layer))
  return { runtime: ManagedRuntime.make(layer), home }
}

class FakeContext {
  params: Record<string, string>
  private readonly values = new Map<unknown, unknown>()
  render = (_node: unknown, init?: ResponseInit) =>
    new Response("rendered", { status: init?.status ?? 200 })
  constructor(project: string) {
    this.params = { project }
  }
  get<T>(key: T): unknown {
    return this.values.get(key)
  }
  set<T>(key: T, value: unknown): void {
    this.values.set(key, value)
  }
}

test("loads the project's runtime, capabilities and info onto the context", async () => {
  const { runtime, home } = makeHubRuntime()
  await runtime.runPromise(
    Effect.gen(function* () {
      const hub = yield* Hub
      yield* hub.add({ name: "m", source: "memory", config: {} })
    }),
  )
  const middleware = loadProject({ runtime, author: "tester" })
  const context = new FakeContext("m")
  let nextCalled = false
  const response = await middleware(context as never, async () => {
    nextCalled = true
    return new Response("ok")
  })
  expect(nextCalled).toBe(true)
  expect(response.status).toBe(200)
  expect(context.get(projectInfoContext)).toMatchObject({ name: "m" })
  expect(context.get(capabilitiesContext)).toEqual({
    groups: true,
    reorder: true,
    renameGroup: true,
    comments: true,
    promote: false,
    cancel: true,
    add: true,
    remove: true,
    edit: true,
    commentAuthor: true,
  })
  expect(context.get(authorContext)).toBe("tester")
  expect(context.get(todoRuntimeContext)).toBeDefined()
  await runtime.dispose()
  rmSync(home, { recursive: true, force: true })
})

test("renders a 404 page for an unknown project without calling next", async () => {
  const { runtime, home } = makeHubRuntime()
  const middleware = loadProject({ runtime, author: "tester" })
  const context = new FakeContext("ghost")
  let nextCalled = false
  const response = await middleware(context as never, async () => {
    nextCalled = true
    return new Response("ok")
  })
  expect(nextCalled).toBe(false)
  expect(response.status).toBe(404)
  await runtime.dispose()
  rmSync(home, { recursive: true, force: true })
})
