import type { Task, TaskId, TodoList } from "../spec/index.ts"

/** A task's derived state (spec §1.3). */
export type TaskState = "ready" | "blocked" | "done"

/** A task with its derived state. */
export interface TaskView {
  readonly task: Task
  readonly state: TaskState
  /** Dependencies that are not satisfied yet, including cancelled and unknown IDs; empty unless blocked. */
  readonly blockedBy: ReadonlyArray<TaskId>
}

export interface SectionView {
  /** `undefined` for the ungrouped section, which is always first. */
  readonly name: string | undefined
  readonly description: string
  readonly tasks: ReadonlyArray<TaskView>
}

/** The derived state of `task`, given the IDs of all tasks that satisfy a dependency. */
export const viewOf = (task: Task, satisfiedIds: ReadonlySet<TaskId>): TaskView => {
  if (task.status === "done") return { task, state: "done", blockedBy: [] }

  const blockedBy = task.dependsOn.filter((id) => !satisfiedIds.has(id))

  return { task, state: blockedBy.length === 0 ? "ready" : "blocked", blockedBy }
}

/** Open tasks in priority order: ungrouped first, then each group in order (spec §1.3). */
export const inPriorityOrder = (list: TodoList): ReadonlyArray<Task> => [
  ...list.ungrouped,
  ...list.groups.flatMap((group) => group.tasks),
]

/** Everything needed to derive state: the open list and the done tasks. */
export interface Board {
  readonly list: TodoList
  readonly done: ReadonlyArray<Task>
  /**
   * The IDs that satisfy a dependency (spec §1.3): done tasks whose outcome is
   * `completed`. A cancelled task is done but never arrived, so depending on
   * one stays blocked — `core/check.ts` reports it.
   */
  readonly satisfiedIds: ReadonlySet<TaskId>
}

export const boardOf = (list: TodoList, done: ReadonlyArray<Task>): Board => ({
  list,
  done,
  satisfiedIds: new Set(done.filter((task) => task.outcome !== "cancelled").map((task) => task.id)),
})

/** All tasks on the board, open (in priority order) then done. */
export const allTasks = (board: Board): ReadonlyArray<Task> => [
  ...inPriorityOrder(board.list),
  ...board.done,
]

export const view =
  (board: Board) =>
  (task: Task): TaskView =>
    viewOf(task, board.satisfiedIds)
