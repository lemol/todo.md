import type { Task, TaskId, TaskStatus } from "../spec/index.ts"
import { formatInlineItem, formatLinkedItem } from "./items.ts"
import { fitsMetadataLine, type InlineFields } from "./metadata.ts"
import type { TaskFile, TaskFileContent } from "./taskFile.ts"
import type { TodoItem } from "./todoFile.ts"

/** The model task for an inline item. A checked item is done, with no completion time yet. */
export const inlineTask = (item: TodoItem, id: TaskId, group: string | undefined): Task => ({
  id,
  title: item.title,
  description: item.description,
  status: item.checked ? "done" : "open",
  tags: item.fields.tags,
  assignee: item.fields.assignee,
  dependsOn: item.fields.dependsOn,
  comments: [],
  group,
  completedAt: undefined,
  outcome: undefined,
  cancelledReason: undefined,
  extra: item.fields.extra,
})

/**
 * The model task for a task file. `title` is the fallback when the frontmatter
 * has none (the link text); `group` is the `TODO.md` section for open tasks and
 * the recorded `group` for done ones. `outcome` and `cancelledReason` are read
 * from the file only when `status` is done, so a still-open item cannot carry
 * a contradictory outcome.
 */
export const fileTask = (
  id: TaskId,
  file: TaskFile,
  options: {
    readonly title: string
    readonly status: TaskStatus
    readonly group: string | undefined
  },
): Task => ({
  id,
  title: file.title ?? options.title,
  description: file.description,
  status: options.status,
  tags: file.tags,
  assignee: file.assignee,
  dependsOn: file.dependsOn,
  comments: file.comments,
  group: options.group,
  completedAt: file.completedAt,
  outcome: options.status === "done" ? file.outcome : undefined,
  cancelledReason: options.status === "done" ? file.cancelledReason : undefined,
  extra: file.extra,
})

export const fieldsOf = (task: Task): InlineFields => ({
  tags: task.tags,
  assignee: task.assignee,
  dependsOn: task.dependsOn,
  extra: task.extra,
})

/** Whether a task can be written inline: no comments, and fields that fit a metadata line (spec §2.9). */
export const fitsInline = (task: Task): boolean =>
  task.comments.length === 0 && fitsMetadataLine(fieldsOf(task))

/** The inline item for a task. Requires `fitsInline(task)`. */
export const inlineItemFor = (task: Task): string[] =>
  formatInlineItem({
    id: task.id,
    title: task.title,
    fields: fieldsOf(task),
    description: task.description,
  })

/** The linked item for a task whose file is at `path` (root-relative). */
export const linkedItemFor = (task: Task, path: string): string[] =>
  formatLinkedItem({ id: task.id, title: task.title, path })

/**
 * The task file content for a task; `group`, `completedAt`, `outcome` and
 * `cancelledReason` are written only for done tasks.
 */
export const taskFileFor = (task: Task): TaskFileContent => ({
  title: task.title,
  tags: task.tags,
  assignee: task.assignee,
  dependsOn: task.dependsOn,
  extra: task.extra,
  description: task.description,
  comments: task.comments,
  group: task.status === "done" ? task.group : undefined,
  completedAt: task.status === "done" ? task.completedAt : undefined,
  outcome: task.status === "done" ? task.outcome : undefined,
  cancelledReason: task.status === "done" ? task.cancelledReason : undefined,
})
