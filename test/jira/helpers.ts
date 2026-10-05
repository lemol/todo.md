/**
 * Fixtures for the Jira source: a fake site, a project directory of its own,
 * and the source built over both. Nothing here reaches a network or a real
 * hub home.
 */

import { BunServices } from "@effect/platform-bun"
import { Effect, Layer, Path, type Scope } from "effect"
import type { Source, SourceEnv, SourceProject } from "../../src/hub/index.ts"
import { type JiraConfig, JiraSource } from "../../src/jira/index.ts"
import { Disk, diskWith } from "../fs/helpers.ts"
import { type FakeJira, type FakeOptions, makeFakeJira } from "./fake.ts"

export interface JiraFixture {
  readonly jira: FakeJira
  readonly source: Source<JiraConfig>
  /** The project's data directory, `<root>/projects/<name>`. */
  readonly dir: string
  readonly config: JiraConfig
  readonly project: SourceProject<JiraConfig>
}

export interface FixtureOptions {
  readonly name?: string
  readonly fake?: FakeOptions
  readonly env?: Record<string, string | undefined>
  readonly config?: Partial<JiraConfig>
  /** Leaves the project unregistered, as the hub does before `add`. */
  readonly unregistered?: boolean
}

export const token = "s3cret"

/** Runs `use` against a fresh fake site and an empty project directory. */
export const withJira = <A, E>(
  use: (fixture: JiraFixture) => Effect.Effect<A, E, SourceEnv | Disk | Scope.Scope>,
  options: FixtureOptions = {},
): Effect.Effect<A, E, Disk | Scope.Scope> =>
  Effect.gen(function* () {
    const { root } = yield* Disk
    const path = yield* Path.Path
    const { jira, layer } = makeFakeJira(options.fake)
    const name = options.name ?? "work"
    const dir = path.join(root, "projects", name)
    const source = yield* JiraSource.make({ env: options.env ?? { JIRA_TOKEN: token } }).pipe(
      Effect.provide(layer),
    )

    const config: JiraConfig = {
      site: jira.site,
      email: "tester@acme.test",
      token_env: "JIRA_TOKEN",
      ...options.config,
    }

    return yield* use({
      jira,
      source,
      dir,
      config,
      project: { name, config, dir: options.unregistered === true ? undefined : dir },
    })
  }).pipe(Effect.provide(BunServices.layer)) as Effect.Effect<A, E, Disk | Scope.Scope>

/** `Disk` plus the platform services a source call needs. */
export const onDisk = (files: Readonly<Record<string, string>> = {}) =>
  Layer.provideMerge(diskWith(files), BunServices.layer)
