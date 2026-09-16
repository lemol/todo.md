import type { DateTime } from "effect"
import type { ProjectInfo } from "../../../hub/index.ts"
import type { ProjectValues } from "../actions/forms.ts"
import { routes } from "../routes.ts"
import { escapeHtml } from "./document.tsx"
import { syncStatusBadge } from "./status.tsx"

export interface ProjectsOptions {
  readonly projects: ReadonlyArray<ProjectInfo>
  /** The kinds the hub loaded, for the add form's source select. */
  readonly sources: ReadonlyArray<string>
  readonly now: DateTime.Utc
  readonly values?: ProjectValues
  readonly issues?: ReadonlyArray<string>
  /** A project whose removal the source refused, with the reason. */
  readonly refusal?: { readonly name: string; readonly message: string }
  /** The project whose inline rename form is open. */
  readonly renaming?: string
}

const row = (info: ProjectInfo, now: DateTime.Utc, renaming: string | undefined): string => {
  const name = escapeHtml(info.name)
  const rename =
    renaming === info.name
      ? `<form method="post" action="${routes.projects.rename.href({ name: info.name })}" class="inline"><input name="to" value="${name}" aria-label="New name for ${name}" required><button type="submit">Save</button></form>`
      : `<a class="secondary" href="${routes.projects.index.href()}?rename=${encodeURIComponent(info.name)}">Rename</a>`
  const sync = info.syncable
    ? `<form method="post" action="${routes.project.sync.href({ project: info.name })}" class="inline"><input type="hidden" name="back" value="${routes.projects.index.href()}"><button class="secondary" type="submit">Sync</button></form>`
    : ""
  return `<tr><td><a href="${routes.project.board.href({ project: info.name })}">${name}</a>${info.registered ? "" : ' <span class="badge blocked">not registered</span>'}</td><td><span class="badge muted">${escapeHtml(info.source)}</span></td><td><code>${escapeHtml(info.location)}</code></td><td>${info.syncable ? syncStatusBadge(info.status, now) : '<span class="muted">—</span>'}</td><td class="row-actions">${sync}${rename}<form method="post" action="${routes.projects.remove.href({ name: info.name })}" class="inline"><button class="secondary danger" type="submit">Remove</button></form></td></tr>`
}

const addForm = (options: ProjectsOptions): string => {
  const values = options.values ?? { target: "", name: "", source: undefined, issues: [] }
  const issues = options.issues ?? []
  const sources = ["infer", ...options.sources]
    .map(
      (kind) =>
        `<option value="${kind}"${(values.source ?? "infer") === kind ? " selected" : ""}>${kind}</option>`,
    )
    .join("")
  return `<section class="add-project"><h2>Add a project</h2>${
    issues.length === 0
      ? ""
      : `<ul class="issues">${issues.map((issue) => `<li class="badge error">${escapeHtml(issue)}</li>`).join("")}</ul>`
  }<form method="post" action="${routes.projects.add.href()}"><label>Target <input name="target" value="${escapeHtml(values.target)}" placeholder="~/labs/acme or https://github.com/owner/repo.git" required></label><label>Name <input name="name" value="${escapeHtml(values.name)}" placeholder="optional"></label><label>Source <select name="source">${sources}</select></label><button type="submit">Add</button></form></section>`
}

const refusal = (options: ProjectsOptions): string => {
  if (options.refusal === undefined) return ""
  const { name, message } = options.refusal
  return `<section class="project-error"><p class="badge error">${escapeHtml(message)}</p><form method="post" action="${routes.projects.remove.href({ name })}" class="inline"><input type="hidden" name="force" value="1"><button class="secondary danger" type="submit">Remove anyway</button></form></section>`
}

export const ProjectsPage = (options: ProjectsOptions): string => {
  const rows = options.projects.map((info) => row(info, options.now, options.renaming)).join("")
  const table =
    options.projects.length === 0
      ? '<p class="empty">No projects yet. Add one below.</p>'
      : `<table class="projects"><thead><tr><th>Name</th><th>Source</th><th>Location</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table>`
  return `<h1>Projects</h1>${refusal(options)}${table}${addForm(options)}`
}
