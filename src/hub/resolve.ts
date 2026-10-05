import { Effect, Option, Path } from "effect"
import { findListRoot } from "../fs/index.ts"
import type { StoreError } from "../spec/index.ts"
import { NoListFound, type ProjectNotFound, type RegistryError } from "./errors.ts"
import { nameForList, uniqueName } from "./names.ts"
import type { Project } from "./projects.ts"
import type { SourceEnv } from "./Source.ts"
import { fsSource } from "./sources/fs.ts"

/** Where a frontend is: its `--project` and `--dir` flags and working directory. */
export interface ResolveInput {
  /** A project name. Wins over `dir`; frontends reject both together before calling. */
  readonly project?: string | undefined
  /** A list directory, relative to `cwd`. */
  readonly dir?: string | undefined
  readonly cwd: string
}

/** Unregistered projects opened in one hub: fs lists, one per list path, kept for the hub's lifetime. */
export interface Unregistered {
  get(name: string): Project | undefined
  all(): ReadonlyArray<Project>
  forget(name: string): void
  /** The list paths currently open, for sources that can say which list is theirs. */
  lists(): ReadonlyArray<string>
  byList(list: string): Project | undefined
  forgetList(list: string): void
  /** The project over `list`, opened on first use with a name that is not in `registered` or already open. */
  open(list: string, registered: ReadonlyArray<string>): Project
}

export const makeUnregistered = (): Unregistered => {
  const byPath = new Map<string, Project>()

  const all = () => [...byPath.values()]

  return {
    get: (name) => all().find((project) => project.name === name),
    all,
    forget: (name) => {
      for (const [list, project] of byPath) if (project.name === name) byPath.delete(list)
    },
    lists: () => [...byPath.keys()],
    byList: (list) => byPath.get(list),
    forgetList: (list) => {
      byPath.delete(list)
    },
    open: (list, registered) => {
      const existing = byPath.get(list)

      if (existing !== undefined) return existing

      const taken = new Set([...registered, ...all().map((project) => project.name)])
      const project: Project = {
        name: uniqueName(nameForList(list) ?? "list", taken),
        kind: fsSource.kind,
        registered: false,
        dir: undefined,
        config: { _tag: "Valid", source: fsSource, value: { path: list } },
      }

      byPath.set(list, project)

      return project
    },
  }
}

/** What resolution needs from the hub. */
export interface Resolution {
  readonly registered: Effect.Effect<ReadonlyArray<Project>, RegistryError>
  find(name: string): Effect.Effect<Project, ProjectNotFound | RegistryError>
  readonly unregistered: Unregistered
}

/**
 * The current project: `project` by name; else an unregistered fs project over
 * `dir`; else the list discovered from `cwd`, which is a registered project if
 * one's source owns it and an unregistered one otherwise.
 */
export const resolveProject = (
  at: ResolveInput,
  hub: Resolution,
): Effect.Effect<Project, ProjectNotFound | RegistryError | NoListFound | StoreError, SourceEnv> =>
  Effect.gen(function* () {
    if (at.project !== undefined) return yield* hub.find(at.project)

    const path = yield* Path.Path
    // A broken registry must not break unregistered lists: it only costs matches and names.
    const registered = yield* hub.registered.pipe(Effect.orElseSucceed(() => []))

    const open = (list: string) =>
      hub.unregistered.open(
        list,
        registered.map((project) => project.name),
      )

    if (at.dir !== undefined) return open(path.resolve(at.cwd, at.dir))

    const root = yield* findListRoot(at.cwd)

    if (Option.isNone(root)) return yield* new NoListFound({ cwd: at.cwd })

    for (const project of registered) {
      const { config } = project

      if (config._tag !== "Valid" || config.source.owns === undefined) continue

      if (yield* config.source.owns(config.value, root.value)) return project
    }

    return open(root.value)
  })
