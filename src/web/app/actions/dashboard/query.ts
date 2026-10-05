import type { OverviewQuery } from "../../../../hub/index.ts"
import { routes } from "../../routes.ts"

export type DashboardView = "projects" | "flat"

export interface DashboardQuery {
  readonly view: DashboardView
  /** The `project` boxes that are ticked; empty means every registered project. */
  readonly projects: ReadonlyArray<string>
  /** The `source` boxes that are ticked; empty means every kind. */
  readonly sources: ReadonlyArray<string>
  readonly tags: ReadonlyArray<string>
  readonly assignee: string | undefined
  readonly state: "ready" | "blocked" | undefined
  /** What `hub.overview` is called with. */
  readonly overview: OverviewQuery
}

/** An enumeration parameter the dashboard cannot honour; the controller answers 400. */
export class InvalidQuery extends Error {}

const list = (url: URL, name: string): ReadonlyArray<string> =>
  url.searchParams
    .getAll(name)
    .map((value) => value.trim())
    .filter((value) => value !== "")

const single = (url: URL, name: string): string | undefined => {
  const value = url.searchParams.get(name)?.trim()

  return value === undefined || value === "" ? undefined : value
}

/**
 * The dashboard's query parameters. Unknown `project` and `source` values are
 * kept: `overviewOf` turns an unknown project into an error entry and an
 * unknown source simply matches nothing. Only the enumerations are rejected.
 */
export const parseDashboardQuery = (url: URL): DashboardQuery => {
  const rawView = single(url, "view") ?? "projects"

  if (rawView !== "projects" && rawView !== "flat") throw new InvalidQuery("Invalid view.")

  const rawState = single(url, "state")

  if (rawState !== undefined && rawState !== "ready" && rawState !== "blocked") {
    throw new InvalidQuery("Invalid state filter.")
  }

  const projects = list(url, "project")
  const sources = list(url, "source")
  const tags = list(url, "tag")
  const assignee = single(url, "assignee")
  const hasFilter = tags.length > 0 || assignee !== undefined || rawState !== undefined

  return {
    view: rawView,
    projects,
    sources,
    tags,
    assignee,
    state: rawState,
    overview: {
      ...(projects.length === 0 ? {} : { projects }),
      ...(sources.length === 0 ? {} : { sources }),
      ...(hasFilter
        ? {
            filter: {
              tags,
              ...(assignee === undefined ? {} : { assignee }),
              ...(rawState === undefined ? {} : { state: rawState }),
            },
          }
        : {}),
    },
  }
}

export interface DashboardPatch {
  readonly view?: DashboardView
  readonly projects?: ReadonlyArray<string>
}

/** The dashboard URL for a query, with `patch` applied. Parameter order is stable. */
export const dashboardHref = (query: DashboardQuery, patch: DashboardPatch = {}): string => {
  const params = new URLSearchParams()

  for (const project of patch.projects ?? query.projects) params.append("project", project)

  for (const source of query.sources) params.append("source", source)

  for (const tag of query.tags) params.append("tag", tag)

  if (query.assignee !== undefined) params.set("assignee", query.assignee)

  if (query.state !== undefined) params.set("state", query.state)

  const view = patch.view ?? query.view

  if (view !== "projects") params.set("view", view)

  const search = params.toString()

  return search === "" ? routes.dashboard.href() : `${routes.dashboard.href()}?${search}`
}
