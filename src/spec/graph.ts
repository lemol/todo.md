import type { TaskId } from "./model.ts"

/**
 * Finds a dependency cycle. `edges` maps each task to the tasks it depends on.
 * Returns the IDs along the first cycle found, starting and ending with the same
 * ID (`["1", "2", "1"]`; a self-dependency is `["3", "3"]`), or `undefined`.
 * Dependencies on IDs missing from `edges` are ignored.
 */
export const findCycle = (
  edges: ReadonlyMap<TaskId, ReadonlyArray<TaskId>>,
): ReadonlyArray<TaskId> | undefined => {
  const finished = new Set<TaskId>()
  const path: TaskId[] = []
  const onPath = new Set<TaskId>()

  const visit = (id: TaskId): ReadonlyArray<TaskId> | undefined => {
    if (onPath.has(id)) return [...path.slice(path.indexOf(id)), id]
    if (finished.has(id) || !edges.has(id)) return undefined
    path.push(id)
    onPath.add(id)
    for (const next of edges.get(id) ?? []) {
      const cycle = visit(next)
      if (cycle !== undefined) return cycle
    }
    path.pop()
    onPath.delete(id)
    finished.add(id)
    return undefined
  }

  for (const id of edges.keys()) {
    const cycle = visit(id)
    if (cycle !== undefined) return cycle
  }
  return undefined
}
