import type { TaskDetail } from "@lemol/todo-md/core"
import type { Capabilities, Task } from "@lemol/todo-md/spec"
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
    ...(task.status === "done" ? [["Completed", formatDate(task.completedAt)]] : []),
  ]
  return `<dl class="metadata">${facts.map(([label, value]) => `<div><dt>${label}</dt><dd><code>${escapeHtml(value)}</code></dd></div>`).join("")}</dl>`
}

export const TaskPage = (options: {
  readonly detail: TaskDetail
  readonly capabilities: Capabilities
  readonly author: string
}): string => {
  const { detail } = options
  const task = detail.view.task
  const dependencies = detail.dependencies
    .map(
      (dependency) =>
        `<li><a href="${routes.tasks.show.href({ id: dependency.id })}">${showId(dependency.id)} ${escapeHtml(dependency.title ?? "unknown")}</a> <span class="badge ${dependency.state}">${dependency.state.toUpperCase()}</span></li>`,
    )
    .join("")
  const blocks = detail.blocks
    .map(
      (view) =>
        `<li><a href="${routes.tasks.show.href({ id: view.task.id })}">${showId(view.task.id)} ${escapeHtml(view.task.title)}</a></li>`,
    )
    .join("")
  const comments = task.comments
    .map(
      (comment) =>
        `<article class="comment"><div class="comment-by"><code>@${escapeHtml(comment.author)} · ${formatMinute(comment.at)}</code></div><div class="markdown">${markdownHtml(comment.body)}</div></article>`,
    )
    .join("")
  const transition =
    task.status === "open"
      ? `<form method="post" action="${routes.tasks.complete.href({ id: task.id })}"><input type="hidden" name="back" value="${routes.tasks.show.href({ id: task.id })}"><button class="primary" type="submit">Complete</button></form>`
      : `<form method="post" action="${routes.tasks.reopen.href({ id: task.id })}"><button class="primary" type="submit">Reopen</button></form>`
  const commentForm = options.capabilities.comments
    ? `<form class="comment-form" method="post" action="${routes.tasks.comments.href({ id: task.id })}"><label>Author <input name="author" value="${escapeHtml(options.author)}" required></label><label>Comment <textarea name="body" required></textarea></label><button class="primary" type="submit">Comment</button></form>`
    : ""
  return `<div class="task-heading"><div><code>${showId(task.id)}</code><h1>${escapeHtml(task.title)}</h1></div><div class="actions">${transition}<a class="secondary" href="${routes.tasks.edit.href({ id: task.id })}">Edit</a></div></div>${metadata(task, detail.view.state)}${task.description === "" ? "" : `<section><h2>Description</h2><div class="markdown">${markdownHtml(task.description)}</div></section>`}<section><h2>Dependencies</h2>${dependencies === "" ? '<p class="empty">No dependencies.</p>' : `<ul>${dependencies}</ul>`}</section><section><h2>Blocks</h2>${blocks === "" ? '<p class="empty">Blocks nothing.</p>' : `<ul>${blocks}</ul>`}</section><section><h2>Comments</h2>${comments || '<p class="empty">No comments.</p>'}${commentForm}</section>`
}

export const valuesOf = (task: Task): EditValues => ({
  title: task.title,
  description: task.description,
  tags: task.tags.join(" "),
  assignee: task.assignee ?? "",
  dependsOn: task.dependsOn.join(" "),
})

export const EditTaskPage = (
  task: Pick<Task, "id">,
  values: EditValues,
  issues: ReadonlyArray<string> = [],
): string =>
  `<h1>Edit task ${showId(task.id)}</h1>${issues.length === 0 ? "" : `<ul class="issues">${issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>`}<form class="edit-form" method="post" action="${routes.tasks.update.href({ id: task.id })}"><label>Title <input name="title" value="${escapeHtml(values.title)}" required></label><label>Description <textarea name="description">${escapeHtml(values.description)}</textarea></label><label>Tags <input name="tags" value="${escapeHtml(values.tags)}"></label><label>Assignee <input name="assignee" value="${escapeHtml(values.assignee)}"></label><label>Depends on <input name="dependsOn" value="${escapeHtml(values.dependsOn)}"></label><button class="primary" type="submit">Save</button></form>`
