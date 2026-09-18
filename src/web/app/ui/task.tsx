import type { TaskDetail } from "../../../core/index.ts"
import type { Capabilities, Task } from "../../../spec/index.ts"
import type { EditValues } from "../actions/forms.ts"
import { routes } from "../routes.ts"
import { escapeHtml } from "./document.tsx"
import { formatDate, formatMinute, showId } from "./format.ts"
import { markdownHtml } from "./markdown.tsx"

const metadata = (task: Task, state: string): string => {
  const facts = [
    ["State", state],
    ["Group", task.group ?? "Ungrouped"],
    ["Tags", task.tags.length === 0 ? "None" : task.tags.map((tag) => `#${tag}`).join(" ")],
    ["Assignee", task.assignee === undefined ? "Unassigned" : `@${task.assignee}`],
    // Absent `outcome` on a done task means completed (spec §1.1): branch on
    // "cancelled" explicitly so every historical done task keeps reading as
    // completed.
    ...(task.status === "done"
      ? task.outcome === "cancelled"
        ? [
            ["Cancelled", formatDate(task.completedAt)],
            ...(task.cancelledReason === undefined ? [] : [["Reason", task.cancelledReason]]),
          ]
        : [["Completed", formatDate(task.completedAt)]]
      : []),
  ]
  return `<dl class="metadata">${facts.map(([label, value]) => `<div><dt>${label}</dt><dd><code>${escapeHtml(value)}</code></dd></div>`).join("")}</dl>`
}

const issueList = (issues: ReadonlyArray<string>): string =>
  issues.length === 0
    ? ""
    : `<ul class="issues">${issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>`

/** Moves an open task to the top or bottom of a group, like `todo mv`. */
const MoveForm = (
  project: string,
  task: Task,
  capabilities: Capabilities,
  groups: ReadonlyArray<string>,
  issues: ReadonlyArray<string>,
): string => {
  const options = [
    `<option value=""${task.group === undefined ? " selected" : ""}>Ungrouped</option>`,
    ...groups.map(
      (group) =>
        `<option value="${escapeHtml(group)}"${task.group === group ? " selected" : ""}>${escapeHtml(group)}</option>`,
    ),
    '<option value="__new__">new group…</option>',
  ]
  const groupFields = capabilities.groups
    ? `<label>Group <select name="group">${options.join("")}</select></label><label>New group <input name="newGroup"></label>`
    : ""
  return `<section><h2>Move</h2>${issueList(issues)}<form class="move-form" method="post" action="${routes.project.tasks.move.href({ project, id: task.id })}"><input type="hidden" name="back" value="${routes.project.tasks.show.href({ project, id: task.id })}">${groupFields}<label>Position <select name="position"><option value="bottom">Bottom</option><option value="top">Top</option></select></label><button class="secondary" type="submit">Move</button></form></section>`
}

export const TaskPage = (options: {
  readonly project: string
  readonly detail: TaskDetail
  readonly capabilities: Capabilities
  readonly author: string
  readonly groups?: ReadonlyArray<string>
  readonly moveIssues?: ReadonlyArray<string>
}): string => {
  const { detail, project } = options
  const task = detail.view.task
  const dependencies = detail.dependencies
    .map(
      (dependency) =>
        `<li><a href="${routes.project.tasks.show.href({ project, id: dependency.id })}">${showId(dependency.id)} ${escapeHtml(dependency.title ?? "unknown")}</a> <span class="badge ${dependency.state}">${dependency.state.toUpperCase()}</span></li>`,
    )
    .join("")
  const blocks = detail.blocks
    .map(
      (view) =>
        `<li><a href="${routes.project.tasks.show.href({ project, id: view.task.id })}">${showId(view.task.id)} ${escapeHtml(view.task.title)}</a></li>`,
    )
    .join("")
  const comments = task.comments
    .map(
      (comment) =>
        `<article class="comment"><div class="comment-by"><code>@${escapeHtml(comment.author)} · ${formatMinute(comment.at)}</code></div><div class="markdown">${markdownHtml(comment.body)}</div></article>`,
    )
    .join("")
  const cancelForm =
    task.status === "open" && options.capabilities.cancel
      ? `<form class="cancel-form" method="post" action="${routes.project.tasks.cancel.href({ project, id: task.id })}"><input type="hidden" name="back" value="${routes.project.tasks.show.href({ project, id: task.id })}"><label>Reason <input name="reason" required></label><button class="secondary" type="submit">Cancel</button></form>`
      : ""
  const transition =
    task.status === "open"
      ? `<form method="post" action="${routes.project.tasks.complete.href({ project, id: task.id })}"><input type="hidden" name="back" value="${routes.project.tasks.show.href({ project, id: task.id })}"><button class="primary" type="submit">Complete</button></form>${cancelForm}`
      : `<form method="post" action="${routes.project.tasks.reopen.href({ project, id: task.id })}"><button class="primary" type="submit">Reopen</button></form>`
  const commentForm = options.capabilities.comments
    ? `<form class="comment-form" method="post" action="${routes.project.tasks.comments.href({ project, id: task.id })}"><label>Author <input name="author" value="${escapeHtml(options.author)}" required></label><label>Comment <textarea name="body" required></textarea></label><button class="primary" type="submit">Comment</button></form>`
    : ""
  const move =
    task.status === "open" && options.capabilities.reorder
      ? MoveForm(
          project,
          task,
          options.capabilities,
          options.groups ?? [],
          options.moveIssues ?? [],
        )
      : ""
  return `<div class="task-heading"><div><code>${showId(task.id)}</code><h1>${escapeHtml(task.title)}</h1></div><div class="actions">${transition}<a class="secondary" href="${routes.project.tasks.edit.href({ project, id: task.id })}">Edit</a><a class="secondary" href="${routes.project.tasks.confirmRemove.href({ project, id: task.id })}">Remove</a></div></div>${metadata(task, detail.view.state)}${task.description === "" ? "" : `<section><h2>Description</h2><div class="markdown">${markdownHtml(task.description)}</div></section>`}<section><h2>Dependencies</h2>${dependencies === "" ? '<p class="empty">No dependencies.</p>' : `<ul>${dependencies}</ul>`}</section><section><h2>Blocks</h2>${blocks === "" ? '<p class="empty">Blocks nothing.</p>' : `<ul>${blocks}</ul>`}</section>${move}<section><h2>Comments</h2>${comments || '<p class="empty">No comments.</p>'}${commentForm}</section>`
}

/**
 * Asks before deleting. With open dependents it lists them and the button
 * sends `force`, since removing leaves them with an unknown dependency.
 */
export const RemoveTaskPage = (
  project: string,
  task: Pick<Task, "id" | "title">,
  dependents: ReadonlyArray<Pick<Task, "id" | "title">>,
  issues: ReadonlyArray<string> = [],
): string => {
  const warning =
    dependents.length === 0
      ? ""
      : `<p class="warning">These open tasks depend on it and will be left with an unknown dependency:</p><ul>${dependents
          .map(
            (dependent) =>
              `<li><a href="${routes.project.tasks.show.href({ project, id: dependent.id })}">${showId(dependent.id)} ${escapeHtml(dependent.title)}</a></li>`,
          )
          .join("")}</ul>`
  return `<h1>Remove task ${showId(task.id)}</h1>${issueList(issues)}<p>Remove <a href="${routes.project.tasks.show.href({ project, id: task.id })}">${showId(task.id)} ${escapeHtml(task.title)}</a> for good? This deletes the task and its file; version control keeps the history.</p>${warning}<form class="actions confirm" method="post" action="${routes.project.tasks.remove.href({ project, id: task.id })}">${dependents.length === 0 ? "" : '<input type="hidden" name="force" value="1">'}<button class="danger" type="submit">${dependents.length === 0 ? "Remove" : "Remove anyway"}</button><a class="secondary" href="${routes.project.tasks.show.href({ project, id: task.id })}">Cancel</a></form>`
}

export const valuesOf = (task: Task): EditValues => ({
  title: task.title,
  description: task.description,
  tags: task.tags.join(" "),
  assignee: task.assignee ?? "",
  dependsOn: task.dependsOn.join(" "),
})

export const EditTaskPage = (
  project: string,
  task: Pick<Task, "id">,
  values: EditValues,
  issues: ReadonlyArray<string> = [],
): string =>
  `<h1>Edit task ${showId(task.id)}</h1>${issueList(issues)}<form class="edit-form" method="post" action="${routes.project.tasks.update.href({ project, id: task.id })}"><label>Title <input name="title" value="${escapeHtml(values.title)}" required></label><label>Description <textarea name="description">${escapeHtml(values.description)}</textarea></label><label>Tags <input name="tags" value="${escapeHtml(values.tags)}"></label><label>Assignee <input name="assignee" value="${escapeHtml(values.assignee)}"></label><label>Depends on <input name="dependsOn" value="${escapeHtml(values.dependsOn)}"></label><button class="primary" type="submit">Save</button></form>`
