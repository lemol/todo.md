import type { TaskView } from "@lemol/todo-md/core"
import type { Diagnostic } from "@lemol/todo-md/spec"
import { routes } from "../routes.ts"
import { escapeHtml } from "./document.tsx"
import { formatDate, showId } from "./format.ts"

export const DonePage = (tasks: ReadonlyArray<TaskView>): string => {
  if (tasks.length === 0) return '<h1>Done</h1><p class="empty">Nothing done.</p>'
  const rows = tasks
    .map(({ task }) => {
      const group = task.group === undefined ? "Ungrouped" : task.group
      return `<article class="done-row"><code>${showId(task.id)}</code><a href="${routes.tasks.show.href({ id: task.id })}">${escapeHtml(task.title)}</a><span><code>${formatDate(task.completedAt)}</code> · ${escapeHtml(group)}</span><form method="post" action="${routes.tasks.reopen.href({ id: task.id })}"><button class="secondary" type="submit">Reopen</button></form></article>`
    })
    .join("")
  return `<h1>Done</h1>${rows}`
}

const severities = ["error", "warning", "info"] as const

export const CheckPage = (diagnostics: ReadonlyArray<Diagnostic>): string => {
  if (diagnostics.length === 0) return '<h1>Check</h1><p class="empty">No diagnostics.</p>'
  const groups = severities
    .flatMap((severity) => {
      const items = diagnostics.filter((item) => item.severity === severity)
      if (items.length === 0) return []
      const label = `${severity[0]?.toUpperCase()}${severity.slice(1)}s`
      return [
        `<section><h2>${label}</h2><ul class="diagnostics">${items
          .map((item) => {
            const task =
              item.taskId === undefined
                ? ""
                : ` <a href="${routes.tasks.show.href({ id: item.taskId })}">task ${showId(item.taskId)}</a>`
            const location =
              item.file === undefined
                ? ""
                : ` <code>${escapeHtml(item.file)}${item.line === undefined ? "" : `:${item.line}`}</code>`
            return `<li><span class="badge ${severity}">${severity.toUpperCase()}</span> <code>${escapeHtml(item.code)}</code> ${escapeHtml(item.message)}${task}${location}</li>`
          })
          .join("")}</ul></section>`,
      ]
    })
    .join("")
  return `<h1>Check</h1>${groups}`
}
