import { type Diagnostic, findCycle, type Task, type TaskId } from "../spec/index.ts"

/**
 * The model-level checks of spec §1.6 over every task, open and done:
 * duplicate IDs, dependencies on unknown IDs, self-dependencies and cycles.
 */
export const modelDiagnostics = (tasks: ReadonlyArray<Task>): ReadonlyArray<Diagnostic> => {
  const diagnostics: Diagnostic[] = []
  const counts = new Map<TaskId, number>()
  for (const task of tasks) counts.set(task.id, (counts.get(task.id) ?? 0) + 1)
  for (const [id, count] of counts) {
    if (count > 1) {
      diagnostics.push({
        severity: "error",
        code: "duplicate-id",
        message: `${count} tasks have ID ${id}`,
        taskId: id,
      })
    }
  }
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (dependency === task.id) {
        diagnostics.push({
          severity: "error",
          code: "self-dependency",
          message: `task ${task.id} depends on itself`,
          taskId: task.id,
        })
      } else if (!counts.has(dependency)) {
        diagnostics.push({
          severity: "error",
          code: "unknown-dependency",
          message: `task ${task.id} depends on unknown task ${dependency}`,
          taskId: task.id,
        })
      }
    }
  }
  // Self-dependencies are reported above, so they are left out of the cycle search.
  const edges = new Map(
    tasks.map((task) => [task.id, task.dependsOn.filter((id) => id !== task.id)] as const),
  )
  const cycle = findCycle(edges)
  const [first] = cycle ?? []
  if (cycle !== undefined && first !== undefined) {
    diagnostics.push({
      severity: "error",
      code: "dependency-cycle",
      message: `dependency cycle: ${cycle.join(" → ")}`,
      taskId: first,
    })
  }
  return diagnostics
}

/** The store's diagnostics, plus model diagnostics it has not already reported (same code and task). */
export const mergeDiagnostics = (
  store: ReadonlyArray<Diagnostic>,
  model: ReadonlyArray<Diagnostic>,
): ReadonlyArray<Diagnostic> => [
  ...store,
  ...model.filter((m) => !store.some((s) => s.code === m.code && s.taskId === m.taskId)),
]
