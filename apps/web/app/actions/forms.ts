import type { TaskFilter } from "@lemol/todo-md/core"
import { taskId } from "../middleware/todo.ts"
import { routes } from "../routes.ts"

export const splitList = (value: string): ReadonlyArray<string> => [
  ...new Set(
    value
      .split(/[\s,]+/)
      .map((part) => part.trim())
      .filter(Boolean),
  ),
]

export const parseTaskFilter = (url: URL): TaskFilter => {
  const state = url.searchParams.get("state")
  if (state !== null && state !== "ready" && state !== "blocked")
    throw new Error("Invalid state filter")
  const assignee = url.searchParams.get("assignee")
  const group = url.searchParams.get("group")
  return {
    tags: url.searchParams.getAll("tag"),
    ...(state === null ? {} : { state }),
    ...(assignee === null ? {} : { assignee }),
    ...(group === null ? {} : { group }),
  }
}

const value = (form: FormData, name: string): string => String(form.get(name) ?? "").trim()

export const parseAddForm = (form: FormData) => {
  const title = value(form, "title")
  const group = value(form, "group")
  const newGroup = value(form, "newGroup")
  const issues = [
    ...(title === "" ? ["Title is required"] : []),
    ...(group === "__new__" && newGroup === "" ? ["New group is required"] : []),
  ]
  return { title, group: group === "__new__" ? newGroup : group, newGroup, issues }
}

export const parseEditForm = (form: FormData) => ({
  title: value(form, "title"),
  description: String(form.get("description") ?? ""),
  tags: value(form, "tags"),
  assignee: value(form, "assignee"),
  dependsOn: value(form, "dependsOn"),
})

export const parseCommentForm = (form: FormData) => ({
  author: value(form, "author"),
  body: String(form.get("body") ?? "").trim(),
})

export const localBack = (value_: string | undefined): string =>
  value_?.startsWith("/") && !value_.startsWith("//") ? value_ : routes.board.href()

export const normalizeDependencies = (value_: string): ReadonlyArray<string> =>
  splitList(value_).map(taskId)
