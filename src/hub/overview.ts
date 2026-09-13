import { Effect, Predicate } from "effect"
import type { Listing, TaskFilter, TaskView } from "../core/index.ts"
import type { StoreError } from "../spec/index.ts"
import {
  type InvalidProjectConfig,
  ProjectNotFound,
  type RegistryError,
  type SourceError,
  type SourceUnavailable,
} from "./errors.ts"
import type { Project } from "./projects.ts"
import { formatRef } from "./refs.ts"
import type { ProjectInfo } from "./Source.ts"

export interface OverviewQuery {
  /** Project names, kept in this order. Default: every registered project, in registry order. */
  readonly projects?: ReadonlyArray<string>
  /** Only projects of these source kinds. Unknown names are always kept. */
  readonly sources?: ReadonlyArray<string>
  /** Passed to each project's `list`. */
  readonly filter?: TaskFilter
}

/** Why a project has no listing. */
export type OverviewError =
  | ProjectNotFound
  | InvalidProjectConfig
  | SourceUnavailable
  | SourceError
  | RegistryError
  | StoreError

export type OverviewEntry =
  | { readonly project: ProjectInfo; readonly listing: Listing }
  | { readonly project: ProjectInfo; readonly error: OverviewError }

export interface OverviewTask {
  readonly project: string
  /** `<project>:<id>`. */
  readonly ref: string
  readonly view: TaskView
}

export interface Overview {
  readonly projects: ReadonlyArray<OverviewEntry>
  /** Each listed project's tasks: in project order, then priority order, then its done tasks. */
  readonly tasks: ReadonlyArray<OverviewTask>
}

/** What `overviewOf` needs from the hub. */
export interface OverviewDeps {
  /** Registered projects in registry order, then unregistered ones opened in the hub. */
  readonly projects: Effect.Effect<ReadonlyArray<Project>, RegistryError>
  describe(project: Project): Effect.Effect<ProjectInfo>
  listing(project: Project, filter: TaskFilter | undefined): Effect.Effect<Listing, OverviewError>
}

/** The entry for a name no project has. */
const missing = (name: string): OverviewEntry => {
  const error = new ProjectNotFound({ name })
  return {
    project: {
      name,
      source: "",
      location: "",
      registered: false,
      syncable: false,
      status: { result: "error", error: error.message },
    },
    error,
  }
}

export const tasksOf = (entries: ReadonlyArray<OverviewEntry>): ReadonlyArray<OverviewTask> =>
  entries.flatMap((entry) => {
    if (!("listing" in entry)) return []
    const { name } = entry.project
    const views = [
      ...entry.listing.sections.flatMap((section) => section.tasks),
      ...entry.listing.done,
    ]
    return views.map((view) => ({ project: name, ref: formatRef(name, view.task.id), view }))
  })

/** `list(filter)` on each chosen project, four at a time; a failing project is an error entry. */
export const overviewOf = (
  query: OverviewQuery,
  deps: OverviewDeps,
): Effect.Effect<Overview, RegistryError> =>
  Effect.gen(function* () {
    const all = yield* deps.projects
    const chosen: ReadonlyArray<Project | string> =
      query.projects === undefined
        ? all.filter((project) => project.registered)
        : query.projects.map((name) => all.find((project) => project.name === name) ?? name)
    const { sources } = query
    const kept =
      sources === undefined
        ? chosen
        : chosen.filter((item) => Predicate.isString(item) || sources.includes(item.kind))
    const entryOf = (project: Project) =>
      Effect.gen(function* () {
        const info = yield* deps.describe(project)
        return yield* deps.listing(project, query.filter).pipe(
          Effect.match({
            onSuccess: (listing): OverviewEntry => ({ project: info, listing }),
            onFailure: (error): OverviewEntry => ({ project: info, error }),
          }),
        )
      })
    const entries = yield* Effect.forEach(
      kept,
      (item) => (Predicate.isString(item) ? Effect.succeed(missing(item)) : entryOf(item)),
      { concurrency: 4 },
    )
    return { projects: entries, tasks: tasksOf(entries) }
  })
