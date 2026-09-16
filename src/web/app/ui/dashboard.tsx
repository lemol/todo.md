import type { DateTime } from "effect"
import type { TaskView } from "../../../core/index.ts"
import type { Overview, OverviewEntry, OverviewTask, ProjectInfo } from "../../../hub/index.ts"
import { type DashboardQuery, dashboardHref } from "../actions/dashboard/query.ts"
import { routes } from "../routes.ts"
import { escapeHtml } from "./document.tsx"
import { showId } from "./format.ts"
import { syncStatusBadge } from "./status.tsx"

export interface DashboardOptions {
  readonly overview: Overview
  /** Every project, for the filter bar; in registry order, unregistered last. */
  readonly projects: ReadonlyArray<ProjectInfo>
  /** The source kinds the hub loaded, for the filter bar. */
  readonly sources: ReadonlyArray<string>
  readonly query: DashboardQuery
  readonly now: DateTime.Utc
  /** True when some project can sync, which is what makes Sync all worth showing. */
  readonly syncable: boolean
}

const MAX_NEXT = 5

const openTasks = (entry: Extract<OverviewEntry, { listing: unknown }>): ReadonlyArray<TaskView> =>
  entry.listing.sections.flatMap((section) => section.tasks)

const counts = (tasks: ReadonlyArray<TaskView>): string => {
  const ready = tasks.filter((view) => view.state === "ready").length
  const blocked = tasks.length - ready
  return `<span class="counts">${tasks.length} open · ${ready} ready · ${blocked} blocked</span>`
}

const registerForm = (info: ProjectInfo): string =>
  `<form method="post" action="${routes.projects.add.href()}" class="inline"><input type="hidden" name="target" value="${escapeHtml(info.location)}"><input type="hidden" name="name" value="${escapeHtml(info.name)}"><input type="hidden" name="source" value="${escapeHtml(info.source)}"><button class="secondary" type="submit">Register</button></form>`

const syncForm = (name: string, back: string): string =>
  `<form method="post" action="${routes.project.sync.href({ project: name })}" class="inline"><input type="hidden" name="back" value="${escapeHtml(back)}"><button class="secondary" type="submit">Sync</button></form>`

const projectHeading = (entry: OverviewEntry, now: DateTime.Utc, back: string): string => {
  const info = entry.project
  const title = "listing" in entry ? entry.listing.title : info.name
  return `<div class="project-heading"><h2><a href="${routes.project.board.href({ project: info.name })}">${escapeHtml(title)}</a></h2><span class="badge muted">${escapeHtml(info.source)}</span>${
    info.syncable ? syncStatusBadge(info.status, now) : ""
  }${info.registered ? "" : `<span class="badge blocked">not registered</span>${registerForm(info)}`}${
    info.syncable ? syncForm(info.name, back) : ""
  }</div>`
}

const nextRow = (project: string, view: TaskView): string =>
  `<li><code>${escapeHtml(project)}:${showId(view.task.id)}</code> <a href="${routes.project.tasks.show.href({ project, id: view.task.id })}">${escapeHtml(view.task.title)}</a></li>`

const projectSection = (entry: OverviewEntry, now: DateTime.Utc, back: string): string => {
  const heading = projectHeading(entry, now, back)
  if (!("listing" in entry)) {
    const retry = entry.project.syncable ? "" : syncForm(entry.project.name, back)
    return `<section class="project project-error">${heading}<p class="badge error">${escapeHtml(entry.error.message)}</p>${retry}</section>`
  }
  const tasks = openTasks(entry)
  const ready = tasks.filter((view) => view.state === "ready")
  const shown = ready.slice(0, MAX_NEXT)
  const rest = ready.length - shown.length
  const body =
    shown.length === 0
      ? '<p class="empty">Nothing ready.</p>'
      : `<ul class="next-tasks">${shown.map((view) => nextRow(entry.project.name, view)).join("")}</ul>${
          rest === 0
            ? ""
            : `<p class="muted"><a href="${routes.project.board.href({ project: entry.project.name })}">${rest} more</a></p>`
        }`
  return `<section class="project">${heading}${counts(tasks)}${body}</section>`
}

const flatRow = (task: OverviewTask): string =>
  `<article class="task-row"><code>${escapeHtml(task.ref)}</code><div class="task-copy"><a class="task-title" href="${routes.project.tasks.show.href({ project: task.project, id: task.view.task.id })}">${escapeHtml(task.view.task.title)}</a></div><div class="task-meta"><a class="chip" href="${escapeHtml(routes.project.board.href({ project: task.project }))}">${escapeHtml(task.project)}</a> <span class="badge ${task.view.state}">${task.view.state.toUpperCase()}</span></div></article>`

const checkbox = (name: string, value: string, checked: boolean, label: string): string =>
  `<label class="check"><input type="checkbox" name="${name}" value="${escapeHtml(value)}"${checked ? " checked" : ""}> ${escapeHtml(label)}</label>`

const filterBar = (options: DashboardOptions): string => {
  const { query } = options
  const projects = options.projects
    .map((info) => checkbox("project", info.name, query.projects.includes(info.name), info.name))
    .join("")
  const sources = options.sources
    .map((kind) => checkbox("source", kind, query.sources.includes(kind), kind))
    .join("")
  const state = ["", "ready", "blocked"]
    .map(
      (value) =>
        `<option value="${value}"${(query.state ?? "") === value ? " selected" : ""}>${value === "" ? "Any state" : value}</option>`,
    )
    .join("")
  const view = (["projects", "flat"] as const)
    .map(
      (value) =>
        `<option value="${value}"${query.view === value ? " selected" : ""}>${value === "projects" ? "By project" : "Flat"}</option>`,
    )
    .join("")
  return `<form class="filters" method="get" action="${routes.dashboard.href()}"><fieldset><legend>Projects</legend>${projects}</fieldset><fieldset><legend>Sources</legend>${sources}</fieldset><label>Tag <input name="tag" value="${escapeHtml(query.tags.join(" "))}"></label><label>Assignee <input name="assignee" value="${escapeHtml(query.assignee ?? "")}"></label><label>State <select name="state">${state}</select></label><label>View <select name="view">${view}</select></label><button type="submit">Filter</button></form>`
}

/** The dashboard body. `back` is where the sync forms return to. */
export const DashboardPage = (options: DashboardOptions): string => {
  const back = dashboardHref(options.query)
  if (options.projects.length === 0) {
    return `<h1>Projects</h1><p class="empty">No projects yet. <a href="${routes.projects.index.href()}">Add one.</a></p>`
  }
  const syncAll = options.syncable
    ? `<form method="post" action="${routes.sync.href()}" class="inline"><input type="hidden" name="back" value="${escapeHtml(back)}"><button type="submit">Sync all</button></form>`
    : ""
  const body =
    options.query.view === "flat"
      ? options.overview.tasks.length === 0
        ? '<p class="empty">Nothing matches these filters.</p>'
        : options.overview.tasks.map(flatRow).join("")
      : options.overview.projects.length === 0
        ? '<p class="empty">Nothing matches these filters.</p>'
        : options.overview.projects
            .map((entry) => projectSection(entry, options.now, back))
            .join("")
  return `<div class="page-heading"><h1>Projects</h1>${syncAll}</div>${filterBar(options)}${body}`
}
