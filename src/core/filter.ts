import type { TaskView } from "./views.ts"

/** Which tasks a query returns. Absent fields do not filter. */
export interface TaskFilter {
  /** Open tasks (the default), done tasks, or both. */
  readonly status?: "open" | "done" | "all"
  /** Only open tasks in this state. */
  readonly state?: "ready" | "blocked"
  /** Tasks carrying every one of these tags. */
  readonly tags?: ReadonlyArray<string>
  readonly assignee?: string
  /** Tasks in (open) or completed in (done) this group. */
  readonly group?: string
}

/** Whether a task passes the filter's state, tag, assignee and group conditions. */
export const matches =
  (filter: TaskFilter) =>
  (view: TaskView): boolean =>
    (filter.state === undefined || view.state === filter.state) &&
    (filter.tags ?? []).every((tag) => view.task.tags.includes(tag)) &&
    (filter.assignee === undefined || view.task.assignee === filter.assignee) &&
    (filter.group === undefined || view.task.group === filter.group)
