import { BunServices } from "@effect/platform-bun"
import { Context, DateTime, Effect, FileSystem, Layer, Path } from "effect"
import type { SourceProject } from "../../src/hub/index.ts"
import { type JiraConfig, JiraSource } from "../../src/jira/index.ts"
import { markdownToAdf } from "../../src/jira/mapping.ts"
import { type Task, TodoStore } from "../../src/spec/index.ts"
import { runConformance, type SeedTask } from "../../src/spec/testing.ts"
import { anIssue, type FakeJira, makeFakeJira, statuses } from "./fake.ts"
import { token } from "./helpers.ts"

/**
 * The Jira store against the conformance suite. Every case gets its own fake
 * site and project directory; its tasks are seeded as issues and synced in,
 * since a Jira project cannot `add`.
 */

interface Fixture {
  readonly jira: FakeJira
  readonly sync: Effect.Effect<unknown, unknown>
  /** The next issue number: `given` may be called more than once per case. */
  next: number
}

/** The fake and sync behind each store, for `seed`, which only sees the store. */
const behind = new WeakMap<TodoStore["Service"], Fixture>()

const layer: Layer.Layer<TodoStore> = Layer.effect(
  TodoStore,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "todo-md-jira-" })
    const { jira, layer: http } = makeFakeJira()
    const source = yield* JiraSource.make({ env: { JIRA_TOKEN: token } }).pipe(Effect.provide(http))
    const config: JiraConfig = {
      site: jira.site,
      email: "tester@acme.test",
      token_env: "JIRA_TOKEN",
    }
    const project: SourceProject<JiraConfig> = {
      name: "work",
      config,
      dir: path.join(root, "projects", "work"),
    }
    const services = yield* Effect.context<FileSystem.FileSystem | Path.Path>()
    const sync = (source.sync?.(project) ?? Effect.die("the Jira source cannot sync")).pipe(
      Effect.provideContext(services),
    )
    yield* sync
    const store = Context.get(yield* Layer.build(source.open(project)), TodoStore)
    behind.set(store, { jira, sync, next: 1 })
    return store
  }).pipe(Effect.orDie),
).pipe(Layer.provide(BunServices.layer))

/** Each task as an issue, done ones resolved now; then a sync brings them in. */
const seed = (tasks: ReadonlyArray<SeedTask>) =>
  Effect.gen(function* () {
    const store = yield* TodoStore
    const fixture = behind.get(store)
    if (fixture === undefined)
      return yield* Effect.die(new Error("the store has no fake behind it"))
    const now = DateTime.formatIso(yield* DateTime.now)
    const keys = tasks.map(() => `PROJ-${fixture.next++}`)
    tasks.forEach((task, index) => {
      fixture.jira.put(
        anIssue(keys[index] ?? "", {
          summary: task.title,
          ...(task.description === undefined
            ? {}
            : { description: markdownToAdf(task.description) }),
          labels: task.tags ?? [],
          ...(task.assignee === undefined ? {} : { assignee: { displayName: task.assignee } }),
          issuelinks: (task.dependsOn ?? []).map((key) => ({
            type: { name: "Blocks" },
            inwardIssue: { key },
          })),
          ...(task.done === true ? { status: statuses.done, resolutiondate: now } : {}),
        }),
      )
    })
    yield* fixture.sync
    const seeded: Array<Task> = []
    for (const key of keys) seeded.push(yield* store.get(key))
    return seeded
  })

runConformance("the Jira store", layer, { seed })
