import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BunServices } from "@effect/platform-bun"
import { Effect, Layer, ManagedRuntime } from "effect"
import type { TodoService } from "../../src/core/index.ts"
import type { AnySource, Source } from "../../src/hub/index.ts"
import { fsSource, Hub } from "../../src/hub/index.ts"
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

export interface HubProject {
  readonly name: string
  /** The registry entry's `source`; default `memory`. */
  readonly source?: string
  /** Extra entry fields, e.g. `{ title: "Acme" }`. */
  readonly fields?: Readonly<Record<string, unknown>>
}

/** A fresh hub home whose registry lists `projects`, written synchronously. */
const homeFor = (projects: ReadonlyArray<HubProject>): string => {
  const home = join(tmpdir(), `todo-md-web-test-${crypto.randomUUID()}`)
  mkdirSync(home, { recursive: true })
  const body = projects
    .map((project) =>
      [
        `  ${project.name}:`,
        `    source: ${project.source ?? "memory"}`,
        ...Object.entries(project.fields ?? {}).map(
          ([key, value]) => `    ${key}: ${JSON.stringify(value)}`,
        ),
      ].join("\n"),
    )
    .join("\n")

  writeFileSync(`${home}/projects.yaml`, `projects:\n${body}\n`)

  return home
}

export interface MakeHubOptions {
  readonly project?: string
  readonly title?: string
  readonly projects?: ReadonlyArray<HubProject>
  readonly capabilities?: Partial<Capabilities>
  readonly extraSources?: ReadonlyArray<AnySource>
  readonly changes?: MemoryHooks["changes"]
}

/**
 * A `ManagedRuntime<Hub>` over a fresh home with one registered project
 * (default name `acme`, title `Acme`).
 */
export const makeHub = (options: MakeHubOptions = {}) => {
  const entries = options.projects ?? [
    { name: options.project ?? "acme", fields: { title: options.title ?? "Acme" } },
  ]

  const project = entries[0]?.name ?? "acme"
  const home = homeFor(entries)
  const source =
    options.capabilities === undefined
      ? memorySource(options.changes === undefined ? {} : { changes: options.changes })
      : memoryWithCapabilities(options.capabilities, options.changes)

  const hubRuntime = ManagedRuntime.make(
    Hub.layer({ home, userHome: home, sources: [source, ...(options.extraSources ?? [])] }).pipe(
      Layer.provide(BunServices.layer),
    ),
  )

  return { hubRuntime, project, home }
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
  /**
   * What the app resolves relative project targets against (default: the hub's
   * temporary home). Never the test process's own directory: this repository is
   * a todo.md list, so a relative target would reach its real backlog.
   */
  readonly cwd?: string
  /** Opens this directory as the unregistered startup project (`fs` is added). */
  readonly listDir?: string
  /** Overrides the startup name passed to the router (for example after `listDir`). */
  readonly startup?: string
}

/**
 * A ready-to-fetch router over one registered `memorySource` project (default
 * name `acme`, title `Acme`, no tasks — use `seed` to add what a test needs).
 * `close()` disposes both the router and the hub runtime.
 */
export const makeRouter = async (options: MakeRouterOptions = {}) => {
  const hubOptions =
    options.listDir === undefined
      ? options
      : {
          ...options,
          projects: options.projects ?? [],
          extraSources: [fsSource, ...(options.extraSources ?? [])],
        }

  const { hubRuntime, project, home } = makeHub(hubOptions)
  let startup = options.startup ?? project
  const listDir = options.listDir

  if (listDir !== undefined) {
    startup = (
      await hubRuntime.runPromise(
        Effect.flatMap(Hub, (hub) => hub.resolve({ dir: listDir, cwd: listDir })),
      )
    ).name
  }

  const runtime: HubRuntime = { runPromise: (effect) => hubRuntime.runPromise(effect) }
  const router = createAppRouter({
    runtime,
    startup,
    cwd: options.cwd ?? home,
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
      rmSync(home, { recursive: true, force: true })
    },
  }
}
