import { mkdirSync, writeFileSync } from "node:fs"
import { BunServices } from "@effect/platform-bun"
import { Effect, Layer, ManagedRuntime } from "effect"
import type { TodoService } from "../../src/core/index.ts"
import type { AnySource, Source } from "../../src/hub/index.ts"
import { Hub } from "../../src/hub/index.ts"
import { type MemoryConfig, type MemoryHooks, memorySource } from "../../src/hub/testing.ts"
import { type Capabilities, TodoStore } from "../../src/spec/index.ts"
import type { AppAssets } from "../../src/web/app/assets.ts"
import type { HubRuntime } from "../../src/web/app/middleware/project.tsx"
import { createAppRouter } from "../../src/web/app/router.ts"

/** A `memorySource` whose store reports `capabilities` overridden for a test. */
export const memoryWithCapabilities = (
  capabilities: Partial<Capabilities>,
  changes?: MemoryHooks["changes"],
): Source<MemoryConfig> => {
  const base = memorySource(changes === undefined ? {} : { changes })
  return {
    ...base,
    open: (project) =>
      Layer.effect(
        TodoStore,
        Effect.gen(function* () {
          const store = yield* TodoStore
          return TodoStore.of({
            ...store,
            capabilities: { ...store.capabilities, ...capabilities },
          })
        }),
      ).pipe(Layer.provide(base.open(project))),
  }
}

/** A fresh hub home with one registered `memory` project, written synchronously. */
const homeFor = (project: string, title: string): string => {
  const home = `/tmp/todo-md-web-test-${crypto.randomUUID()}`
  mkdirSync(home, { recursive: true })
  writeFileSync(
    `${home}/projects.yaml`,
    `projects:\n  ${project}:\n    source: memory\n    title: ${JSON.stringify(title)}\n`,
  )
  return home
}

export interface MakeHubOptions {
  readonly project?: string
  readonly title?: string
  readonly capabilities?: Partial<Capabilities>
  readonly extraSources?: ReadonlyArray<AnySource>
  readonly changes?: MemoryHooks["changes"]
}

/**
 * A `ManagedRuntime<Hub>` over a fresh home with one registered project
 * (default name `acme`, title `Acme`).
 */
export const makeHub = (options: MakeHubOptions = {}) => {
  const project = options.project ?? "acme"
  const home = homeFor(project, options.title ?? "Acme")
  const source =
    options.capabilities === undefined
      ? memorySource(options.changes === undefined ? {} : { changes: options.changes })
      : memoryWithCapabilities(options.capabilities, options.changes)
  const hubRuntime = ManagedRuntime.make(
    Hub.layer({ home, userHome: home, sources: [source, ...(options.extraSources ?? [])] }).pipe(
      Layer.provide(BunServices.layer),
    ),
  )
  return { hubRuntime, project }
}

/** Runs `use` against `project`'s `TodoService` through the hub. */
export const seed = <A, E>(
  hubRuntime: ReturnType<typeof makeHub>["hubRuntime"],
  project: string,
  use: (todo: TodoService["Service"]) => Effect.Effect<A, E, never>,
) => hubRuntime.runPromise(Effect.flatMap(Hub, (hub) => Effect.flatMap(hub.todo(project), use)))

export const makeFakeAssets = (): AppAssets => ({
  getScriptEntry: async (path) => ({
    href: `/assets/${path}`,
    importMap: { imports: {}, scopes: {} },
    preloads: [],
  }),
  fetch: async () => null,
  close: async () => undefined,
})

export interface MakeRouterOptions extends MakeHubOptions {
  readonly assets?: AppAssets
}

/**
 * A ready-to-fetch router over one registered `memorySource` project (default
 * name `acme`, title `Acme`, no tasks — use `seed` to add what a test needs).
 * `close()` disposes both the router and the hub runtime.
 */
export const makeRouter = (options: MakeRouterOptions = {}) => {
  const { hubRuntime, project } = makeHub(options)
  const runtime: HubRuntime = { runPromise: (effect) => hubRuntime.runPromise(effect) }
  const router = createAppRouter({
    runtime,
    startup: project,
    author: "tester",
    hosts: ["localhost", "127.0.0.1", "::1"],
    sessionSecret: "test-secret-at-least-32-characters",
    assets: options.assets ?? makeFakeAssets(),
  })
  return {
    router,
    project,
    hubRuntime,
    close: async () => {
      await router.close()
      await hubRuntime.dispose()
    },
  }
}
