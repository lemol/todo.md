import { Context, type Effect } from "effect"
import type { Diagnostic, StoreError, Task, TaskId, TaskRef } from "../spec/index.ts"
import type { TaskState, TaskView } from "./views.ts"

/** Foreign dependency detail for `show`. */
export interface ResolvedDependency {
  readonly title: string | undefined
  readonly state: TaskState | "unknown" | "cancelled"
}

/**
 * How `TodoService` resolves `<project>:<id>` dependencies. `core` ships no
 * implementation: standalone services fall back to treating every foreign
 * reference as unsatisfied with an `unresolvable-project` warning (spec §1.3).
 * The hub provides a layer that resolves through registered projects.
 */
export class DependencyResolver extends Context.Service<
  DependencyResolver,
  {
    /** The subset of `ids` whose foreign task is done with outcome `completed`. */
    readonly satisfied: (
      ids: ReadonlyArray<TaskId>,
    ) => Effect.Effect<ReadonlySet<TaskId>, StoreError>
    /** Title and state for each foreign `id`; missing tasks resolve to `unknown`. */
    readonly resolve: (
      ids: ReadonlyArray<TaskId>,
    ) => Effect.Effect<ReadonlyMap<TaskId, ResolvedDependency>, StoreError>
    /** Foreign-dependency diagnostics for `tasks`; never fails the list. */
    readonly diagnostics: (
      tasks: ReadonlyArray<Task>,
    ) => Effect.Effect<ReadonlyArray<Diagnostic>, StoreError>
    /** Open tasks (as views) newly unblocked when `completed` finishes. */
    readonly unblocked: (completed: TaskRef) => Effect.Effect<ReadonlyArray<TaskView>, StoreError>
  }
>()("@lemol/todo-md/core/DependencyResolver") {}
