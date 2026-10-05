import { Context, Effect, Layer, Option } from "effect"
import {
  type Capabilities,
  type Comment,
  type CommentInput,
  type Diagnostic,
  type GroupNotFound,
  type InvalidTransition,
  type Placement,
  type StoreError,
  type Task,
  type TaskId,
  type TaskInput,
  type TaskNotFound,
  type TaskPatch,
  TodoStore,
  Unsupported,
  type ValidationError,
} from "../spec/index.ts"
import { mergeDiagnostics, modelDiagnostics } from "./check.ts"
import { HasDependents } from "./errors.ts"
import { matches, type TaskFilter } from "./filter.ts"
import { DependencyResolver } from "./resolver.ts"
import {
  allTasks,
  boardOf,
  inPriorityOrder,
  type SectionView,
  type TaskState,
  type TaskView,
  view,
} from "./views.ts"

/** What `list` returns: the list's sections with their matching open tasks, and matching done tasks. */
export interface Listing {
  readonly title: string
  readonly description: string
  /** The ungrouped section first, then each group; empty when the filter asks only for done tasks. */
  readonly sections: ReadonlyArray<SectionView>
  /** Done tasks, most recently completed first; empty unless the filter asks for them. */
  readonly done: ReadonlyArray<TaskView>
}

export interface Dependency {
  readonly id: TaskId
  /** `undefined` when no task has this ID. */
  readonly title: string | undefined
  readonly state: TaskState | "unknown" | "cancelled"
}

/** What `show` returns. */
export interface TaskDetail {
  readonly view: TaskView
  readonly dependencies: ReadonlyArray<Dependency>
  /** Open tasks that depend on this one. */
  readonly blocks: ReadonlyArray<TaskView>
}

/** What `complete` returns: the done task, and the open tasks it made ready. */
export interface Completion {
  readonly task: Task
  readonly unblocked: ReadonlyArray<TaskView>
}

/**
 * Adapter-agnostic todo.md logic over any `TodoStore`: queries with derived
 * state, validation, and guarded mutations. Frontends use this, not the store.
 */
export class TodoService extends Context.Service<
  TodoService,
  {
    readonly capabilities: Capabilities
    list(filter?: TaskFilter): Effect.Effect<Listing, StoreError>
    /** Ready open tasks in priority order: "what should I work on?" */
    next(filter?: TaskFilter): Effect.Effect<ReadonlyArray<TaskView>, StoreError>
    show(id: TaskId): Effect.Effect<TaskDetail, TaskNotFound | StoreError>
    /** Returns a task directly from the store without computing derived board state. */
    get(id: TaskId): Effect.Effect<Task, TaskNotFound | StoreError>
    /** Returns all tasks (open and done) directly from the store without computing derived board state. */
    tasks(): Effect.Effect<ReadonlyArray<Task>, StoreError>
    /** The store's diagnostics plus the model checks of spec §1.6. */
    check(): Effect.Effect<ReadonlyArray<Diagnostic>, StoreError>
    add(
      input: TaskInput,
      placement?: Placement,
    ): Effect.Effect<Task, ValidationError | TaskNotFound | Unsupported | StoreError>
    update(
      id: TaskId,
      patch: TaskPatch,
    ): Effect.Effect<Task, TaskNotFound | ValidationError | StoreError>
    move(
      id: TaskId,
      placement: Placement,
    ): Effect.Effect<
      Task,
      TaskNotFound | InvalidTransition | ValidationError | Unsupported | StoreError
    >
    complete(id: TaskId): Effect.Effect<Completion, TaskNotFound | InvalidTransition | StoreError>
    reopen(id: TaskId): Effect.Effect<Task, TaskNotFound | InvalidTransition | StoreError>
    cancel(
      id: TaskId,
      reason: string,
    ): Effect.Effect<
      Task,
      TaskNotFound | InvalidTransition | ValidationError | Unsupported | StoreError
    >
    /** Refuses with `HasDependents` while open tasks depend on the task, unless `force`. */
    remove(
      id: TaskId,
      options?: { readonly force?: boolean },
    ): Effect.Effect<void, TaskNotFound | HasDependents | Unsupported | StoreError>
    renameGroup(
      from: string,
      to: string,
    ): Effect.Effect<void, GroupNotFound | ValidationError | Unsupported | StoreError>
    comment(
      id: TaskId,
      input: CommentInput,
    ): Effect.Effect<Comment, TaskNotFound | ValidationError | Unsupported | StoreError>
    /** Gives the task its own document (spec §2.9); a no-op when it already has one. */
    promote(id: TaskId): Effect.Effect<Task, TaskNotFound | Unsupported | StoreError>
  }
>()("@lemol/todo-md/core/TodoService") {
  static readonly layer: Layer.Layer<TodoService, never, TodoStore> = Layer.effect(
    TodoService,
    Effect.gen(function* () {
      const store = yield* TodoStore
      const resolverOption = yield* Effect.serviceOption(DependencyResolver)
      const resolver = Option.getOrUndefined(resolverOption)

      const foreignIdsOf = (tasks: ReadonlyArray<Task>): ReadonlyArray<TaskId> => [
        ...new Set(tasks.flatMap((task) => task.dependsOn).filter((id) => id.includes(":"))),
      ]

      const board = Effect.gen(function* () {
        const [list, done] = yield* Effect.all([store.load(), store.listDone()])
        const base = boardOf(list, done)

        if (resolver === undefined) return base

        const foreignIds = foreignIdsOf([...inPriorityOrder(list), ...done])

        if (foreignIds.length === 0) return base

        const satisfied = yield* resolver.satisfied(foreignIds)

        return {
          ...base,
          satisfiedIds: new Set([...base.satisfiedIds, ...satisfied]),
        }
      })

      /** Fails early when the store lacks a capability (spec §1.5). */
      const requires = (capability: keyof Capabilities, operation: string) =>
        store.capabilities[capability] ? Effect.void : Effect.fail(new Unsupported({ operation }))

      const placementNeeds = (placement: Placement, operation: string) =>
        Effect.all([
          placement.group === undefined ? Effect.void : requires("groups", operation),
          placement.before === undefined && placement.after === undefined
            ? Effect.void
            : requires("reorder", operation),
        ])

      return TodoService.of({
        capabilities: store.capabilities,

        list: (filter = {}) =>
          Effect.map(board, (b) => {
            const keep = matches(filter)
            const status = filter.status ?? "open"
            const sections = [
              { name: undefined, description: b.list.description, tasks: b.list.ungrouped },
              ...b.list.groups,
            ].map((section) => ({
              name: section.name,
              description: section.description,
              tasks: section.tasks.map(view(b)).filter(keep),
            }))

            return {
              title: b.list.title,
              description: b.list.description,
              sections: status === "done" ? [] : sections,
              done: status === "open" ? [] : b.done.map(view(b)).filter(keep),
            }
          }),

        next: (filter = {}) =>
          Effect.map(board, (b) =>
            inPriorityOrder(b.list)
              .map(view(b))
              .filter((v) => v.state === "ready" && matches(filter)(v)),
          ),

        get: (id) => store.get(id),

        tasks: () =>
          Effect.map(Effect.all([store.load(), store.listDone()]), ([list, done]) => [
            ...inPriorityOrder(list),
            ...done,
          ]),

        show: (id) =>
          Effect.gen(function* () {
            const task = yield* store.get(id)
            const b = yield* board
            const byId = new Map(allTasks(b).map((t) => [t.id, t] as const))
            const foreignIds = task.dependsOn.filter((dependency) => !byId.has(dependency))
            const resolved =
              resolver !== undefined && foreignIds.length > 0
                ? yield* resolver.resolve(foreignIds)
                : new Map()

            return {
              view: view(b)(task),
              dependencies: task.dependsOn.map((dependency) => {
                const found = byId.get(dependency)

                if (found !== undefined) {
                  return {
                    id: dependency,
                    title: found.title,
                    state:
                      found.outcome === "cancelled" ? ("cancelled" as const) : view(b)(found).state,
                  }
                }

                const foreign = resolved.get(dependency)

                return {
                  id: dependency,
                  title: foreign?.title,
                  state: foreign?.state ?? ("unknown" as const),
                }
              }),
              blocks: inPriorityOrder(b.list)
                .filter((t) => t.dependsOn.includes(id))
                .map(view(b)),
            }
          }),

        check: () =>
          Effect.gen(function* () {
            const [diagnostics, b] = yield* Effect.all([store.diagnostics(), board])
            const model = modelDiagnostics(allTasks(b))

            if (resolver === undefined) return mergeDiagnostics(diagnostics, model)

            const local = model.filter((d) => d.code !== "unresolvable-project")
            const foreign = yield* resolver.diagnostics(allTasks(b))

            return mergeDiagnostics(diagnostics, [...local, ...foreign])
          }),

        add: (input, placement = {}) =>
          requires("add", "add").pipe(
            Effect.andThen(placementNeeds(placement, "add")),
            Effect.andThen(store.add(input, placement)),
          ),

        update: (id, patch) => store.update(id, patch),

        move: (id, placement) =>
          requires("reorder", "move").pipe(
            Effect.andThen(placementNeeds(placement, "move")),
            Effect.andThen(store.move(id, placement)),
          ),

        complete: (id) =>
          Effect.gen(function* () {
            const task = yield* store.complete(id)
            const b = yield* board
            const unblocked = inPriorityOrder(b.list)
              .filter((t) => t.dependsOn.includes(id))
              .map(view(b))
              .filter((v) => v.state === "ready")

            return { task, unblocked }
          }),

        reopen: (id) => store.reopen(id),

        cancel: (id, reason) =>
          requires("cancel", "cancel").pipe(Effect.andThen(store.cancel(id, reason))),

        remove: (id, options = {}) =>
          Effect.gen(function* () {
            yield* requires("remove", "remove")
            yield* store.get(id)

            if (options.force !== true) {
              const dependents = inPriorityOrder((yield* board).list)
                .filter((t) => t.dependsOn.includes(id))
                .map((t) => t.id)

              if (dependents.length > 0) return yield* new HasDependents({ id, dependents })
            }

            yield* store.remove(id)
          }),

        renameGroup: (from, to) =>
          requires("renameGroup", "renameGroup").pipe(Effect.andThen(store.renameGroup(from, to))),

        comment: (id, input) =>
          requires("comments", "comment").pipe(Effect.andThen(store.comment(id, input))),

        promote: (id) => requires("promote", "promote").pipe(Effect.andThen(store.promote(id))),
      })
    }),
  )
}
