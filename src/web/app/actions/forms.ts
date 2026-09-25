import type { TaskFilter } from "../../../core/index.ts"
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

export type EditValues = ReturnType<typeof parseEditForm>

export const parseCommentForm = (form: FormData) => ({
  author: value(form, "author"),
  body: String(form.get("body") ?? "").trim(),
})

/**
 * A blank reason is caught by the `reason` field's `required` attribute in
 * the UI; if that's bypassed, the store rejects it with a `ValidationError`
 * that the generic error page renders.
 */
export const parseCancelForm = (form: FormData) => ({
  reason: value(form, "reason"),
})

/**
 * A board arrow sends `before` or `after`; the task page's form sends a target
 * `group` (or `__new__` with `newGroup`) and a `position`.
 */
export const parseMoveForm = (form: FormData) => {
  const before = value(form, "before")
  const after = value(form, "after")
  const group = value(form, "group")
  const newGroup = value(form, "newGroup")
  const issues = group === "__new__" && newGroup === "" ? ["New group is required"] : []
  return {
    before: before === "" ? undefined : taskId(before),
    after: after === "" ? undefined : taskId(after),
    group: group === "__new__" ? newGroup : group,
    position: value(form, "position") === "top" ? ("top" as const) : ("bottom" as const),
    issues,
  }
}

export const parseRenameForm = (form: FormData) => ({
  from: value(form, "from"),
  to: value(form, "to"),
})

/** `localBack` for hub routes, which have no project to fall back to. */
export const hubBack = (value_: string | undefined, fallback: string): string =>
  value_?.startsWith("/") &&
  !value_.startsWith("//") &&
  !value_.includes("\\") &&
  ![...value_].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
    ? value_
    : fallback

export const localBack = (value_: string | undefined, project: string): string =>
  hubBack(value_, routes.project.board.href({ project }))

/**
 * The add-a-project form: a path, URL or Jira site, an optional name and a
 * source kind, plus the git-only and jira-only fields. Whether they fit the
 * target is decided once the source is known, in the controller.
 */
export const parseProjectForm = (form: FormData) => {
  const target = value(form, "target")
  const name = value(form, "name")
  const source = value(form, "source")
  const branch = value(form, "branch")
  const list = value(form, "list")
  const email = value(form, "email")
  const tokenEnv = value(form, "token_env")
  const tokenCommand = value(form, "token_command")
  const jql = value(form, "jql")
  const readOnly = form.get("read_only") !== null
  return {
    target,
    name,
    source: source === "" || source === "infer" ? undefined : source,
    branch,
    list,
    email,
    tokenEnv,
    tokenCommand,
    jql,
    readOnly,
    issues: target === "" ? ["A path or URL is required"] : [],
  }
}

export type ProjectValues = ReturnType<typeof parseProjectForm>

export const normalizeDependencies = (value_: string): ReadonlyArray<string> =>
  splitList(value_).map(taskId)
