import type { Listing, TaskView } from "@lemol/todo-md/core"
import type { Capabilities } from "@lemol/todo-md/spec"
import { routes } from "../routes.ts"
import { escapeHtml } from "./document.tsx"
import { showId } from "./format.ts"
import { markdownHtml } from "./markdown.tsx"

export interface AddValues {
  readonly title: string
  readonly group: string
  readonly newGroup: string
}

const queryHref = (back: string, name: string, value: string): string => {
  const current = new URL(back, "http://todo-md.local")
  const query = current.searchParams
  if (name === "tag") {
    if (!query.getAll(name).includes(value)) query.append(name, value)
  } else query.set(name, value)
  return `${routes.board.href()}?${query}`
}

export const TaskRow = (
  view: TaskView,
  options: { readonly next: boolean; readonly back: string },
): string => {
  const { task } = view
  const tags = task.tags
    .map(
      (tag) =>
        `<a class="chip" href="${escapeHtml(queryHref(options.back, "tag", tag))}">#${escapeHtml(tag)}</a>`,
    )
    .join(" ")
  const assignee =
    task.assignee === undefined
      ? ""
      : `<a class="assignee" href="${escapeHtml(queryHref(options.back, "assignee", task.assignee))}">@${escapeHtml(task.assignee)}</a>`
  const blockedBy =
    view.blockedBy.length === 0
      ? ""
      : `<div class="blocked-by">blocked by ${view.blockedBy
          .map((id) => `<a href="${routes.tasks.show.href({ id })}">${showId(id)}</a>`)
          .join(", ")}</div>`
  return `<article class="task-row${options.next ? " next" : ""}"${options.next ? ' data-next="true"' : ""}><form method="post" action="${routes.tasks.complete.href({ id: task.id })}"><input type="hidden" name="back" value="${escapeHtml(options.back)}"><button class="checkbox" aria-label="Complete ${escapeHtml(task.title)}" type="submit"></button></form><code>${showId(task.id)}</code><div class="task-copy"><a class="task-title" href="${routes.tasks.show.href({ id: task.id })}">${escapeHtml(task.title)}</a>${blockedBy}</div><div class="task-meta">${tags} ${assignee} <span class="badge ${view.state}">${view.state.toUpperCase()}</span></div></article>`
}

export const AddTaskForm = (
  listing: Listing,
  capabilities: Capabilities,
  values: AddValues = { title: "", group: "", newGroup: "" },
  issues: ReadonlyArray<string> = [],
): string => {
  const groups = listing.sections.flatMap((section) =>
    section.name === undefined
      ? []
      : [
          `<option value="${escapeHtml(section.name)}"${values.group === section.name ? " selected" : ""}>${escapeHtml(section.name)}</option>`,
        ],
  )
  const groupFields = capabilities.groups
    ? `<label>Group <select name="group"><option value="">Ungrouped</option>${groups.join("")}<option value="__new__"${values.group === "__new__" ? " selected" : ""}>new group…</option></select></label><label>New group <input name="newGroup" value="${escapeHtml(values.newGroup)}"></label>`
    : ""
  return `<section class="add-task"><h2>Add task</h2>${issues.length === 0 ? "" : `<ul class="issues">${issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>`}<form method="post" action="${routes.tasks.add.href()}"><label>Title <input name="title" value="${escapeHtml(values.title)}" required></label>${groupFields}<button class="primary" type="submit">Add task</button></form></section>`
}

export const BoardPage = (options: {
  readonly listing: Listing
  readonly nextIds: ReadonlySet<string>
  readonly capabilities: Capabilities
  readonly back: string
  readonly addValues?: AddValues
  readonly addIssues?: ReadonlyArray<string>
}): string => {
  const views = options.listing.sections.flatMap((section) => section.tasks)
  const ready = views.filter((view) => view.state === "ready").length
  const blocked = views.length - ready
  const sections = options.listing.sections
    .filter((section) => section.tasks.length > 0)
    .map((section) => {
      const heading =
        section.name === undefined
          ? "Ungrouped"
          : `<a href="${escapeHtml(queryHref(options.back, "group", section.name))}">${escapeHtml(section.name)}</a>`
      return `<section class="task-section"><h2>${heading}</h2>${section.description === "" ? "" : `<div class="section-description markdown">${markdownHtml(section.description)}</div>`}${section.tasks.map((view) => TaskRow(view, { next: options.nextIds.has(view.task.id), back: options.back })).join("")}</section>`
    })
    .join("")
  return `<h1>${escapeHtml(options.listing.title)}</h1>${options.listing.description === "" ? "" : `<div class="list-description markdown">${markdownHtml(options.listing.description)}</div>`}<p class="summary">${views.length} open · ${ready} ready · ${blocked} blocked</p>${AddTaskForm(options.listing, options.capabilities, options.addValues, options.addIssues)}${sections || '<p class="empty">Nothing open. Add a task above.</p>'}`
}
