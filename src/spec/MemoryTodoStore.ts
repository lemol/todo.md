/**
 * The reference `TodoStore`: the whole list lives in memory. It is the
 * simplest executable statement of the operation semantics in spec §1.4.
 */

import { DateTime, Effect, Layer, SynchronizedRef } from "effect"
import {
  GroupNotFound,
  InvalidTransition,
  TaskNotFound,
  Unsupported,
  ValidationError,
} from "./errors.ts"
import {
  type Comment,
  CommentInput,
  Label,
  Placement,
  type Task,
  type TaskId,
  TaskInput,
  TaskPatch,
  type TodoList,
} from "./model.ts"
import { allCapabilities, TodoStore } from "./TodoStore.ts"
import { ensureAcyclic, unique, validate } from "./validation.ts"

interface Section {
  /** `undefined` for the ungrouped section, which is always first. */
  readonly name: string | undefined
  readonly description: string
  readonly tasks: ReadonlyArray<Task>
}

interface State {
  readonly title: string
  readonly description: string
  readonly sections: ReadonlyArray<Section>
  /** Done tasks, most recently completed first. */
  readonly done: ReadonlyArray<Task>
  readonly lastId: number
}

interface Located {
  readonly sectionIndex: number
  readonly taskIndex: number
  readonly task: Task
}

const locateOpen = (state: State, id: TaskId): Located | undefined => {
  for (const [sectionIndex, section] of state.sections.entries()) {
    const taskIndex = section.tasks.findIndex((task) => task.id === id)
    const task = section.tasks[taskIndex]

    if (task !== undefined) return { sectionIndex, taskIndex, task }
  }

  return undefined
}

const findTask = (state: State, id: TaskId): Effect.Effect<Task, TaskNotFound> => {
  const task = locateOpen(state, id)?.task ?? state.done.find((done) => done.id === id)

  return task === undefined ? Effect.fail(new TaskNotFound({ id })) : Effect.succeed(task)
}

const findOpen = (
  state: State,
  id: TaskId,
  operation: string,
): Effect.Effect<Located, TaskNotFound | InvalidTransition> => {
  const located = locateOpen(state, id)

  if (located !== undefined) return Effect.succeed(located)

  return Effect.fail(
    state.done.some((task) => task.id === id)
      ? new InvalidTransition({ id, status: "done", operation })
      : new TaskNotFound({ id }),
  )
}

const allTasks = (state: State): ReadonlyArray<Task> => [
  ...state.sections.flatMap((section) => section.tasks),
  ...state.done,
]

const withoutTask = (state: State, id: TaskId): State => ({
  ...state,
  sections: state.sections.map((section) => ({
    ...section,
    tasks: section.tasks.filter((task) => task.id !== id),
  })),
  done: state.done.filter((task) => task.id !== id),
})

const replaceTask = (state: State, updated: Task): State => ({
  ...state,
  sections: state.sections.map((section) => ({
    ...section,
    tasks: section.tasks.map((task) => (task.id === updated.id ? updated : task)),
  })),
  done: state.done.map((task) => (task.id === updated.id ? updated : task)),
})

/** The index just past the last task of `group`, or 0 if the group does not exist. */
const endOf = (state: State, group: string | undefined): number =>
  state.sections.find((section) => section.name === group)?.tasks.length ?? 0

/** Inserts `task` into `group` (created at the end of the list if missing) at `index`. */
const insert = (state: State, group: string | undefined, index: number, task: Task): State => {
  const sections = state.sections.some((section) => section.name === group)
    ? state.sections
    : [...state.sections, { name: group, description: "", tasks: [] }]

  return {
    ...state,
    sections: sections.map((section) =>
      section.name === group
        ? {
            ...section,
            tasks: [
              ...section.tasks.slice(0, index),
              { ...task, group },
              ...section.tasks.slice(index),
            ],
          }
        : section,
    ),
  }
}

/** Resolves a placement against `state`, which must not contain the task being placed. */
const resolve = (
  state: State,
  placement: Placement,
): Effect.Effect<
  { readonly group: string | undefined; readonly index: number },
  TaskNotFound | ValidationError
> => {
  if (placement.before !== undefined && placement.after !== undefined) {
    return Effect.fail(
      new ValidationError({ issues: ["a placement takes before or after, not both"] }),
    )
  }

  const anchorId = placement.before ?? placement.after

  if (anchorId === undefined) {
    return Effect.succeed({ group: placement.group, index: endOf(state, placement.group) })
  }

  const anchor = locateOpen(state, anchorId)

  if (anchor === undefined) return Effect.fail(new TaskNotFound({ id: anchorId }))

  const group = state.sections[anchor.sectionIndex]?.name

  if (placement.group !== undefined && placement.group !== group) {
    return Effect.fail(
      new ValidationError({ issues: [`task ${anchorId} is not in group ${placement.group}`] }),
    )
  }

  const index = placement.before !== undefined ? anchor.taskIndex : anchor.taskIndex + 1

  return Effect.succeed({ group, index })
}

export interface Options {
  readonly title?: string
  readonly description?: string
  /** Set to `false` to exercise the absent path for the `cancel` capability. */
  readonly cancel?: boolean
}

/** Builds a fresh, empty in-memory store each time the layer is provided. */
export const layer = (options: Options = {}): Layer.Layer<TodoStore> =>
  Layer.effect(
    TodoStore,
    Effect.gen(function* () {
      const ref = yield* SynchronizedRef.make<State>({
        title: options.title ?? "",
        description: options.description ?? "",
        sections: [{ name: undefined, description: "", tasks: [] }],
        done: [],
        lastId: 0,
      })

      const read = SynchronizedRef.get(ref)

      // The new state is kept only if `f` succeeds, so failed operations change nothing.
      const transact = <A, E>(f: (state: State) => Effect.Effect<readonly [A, State], E>) =>
        SynchronizedRef.modifyEffect(ref, f)

      return TodoStore.of({
        // Promotion moves a task's detail into its own document; this store has
        // no documents to move it into (spec §1.5).
        capabilities: { ...allCapabilities, promote: false, cancel: options.cancel ?? true },

        load: () =>
          Effect.map(read, (state): TodoList => {
            const [ungrouped, ...groups] = state.sections

            return {
              title: state.title,
              description: state.description,
              ungrouped: ungrouped?.tasks ?? [],
              groups: groups.map((section) => ({
                name: section.name ?? "",
                description: section.description,
                tasks: section.tasks,
              })),
            }
          }),

        get: (id) => Effect.flatMap(read, (state) => findTask(state, id)),

        listDone: () => Effect.map(read, (state) => state.done),

        add: (input, placement = {}) =>
          transact((state) =>
            Effect.gen(function* () {
              const valid = yield* validate(TaskInput, input)
              const where = yield* validate(Placement, placement)
              const target = yield* resolve(state, where)
              const task: Task = {
                id: String(state.lastId + 1),
                title: valid.title,
                description: valid.description ?? "",
                status: "open",
                tags: unique(valid.tags ?? []),
                assignee: valid.assignee,
                dependsOn: unique(valid.dependsOn ?? []),
                comments: [],
                group: target.group,
                extra: valid.extra ?? {},
              }

              const next = insert(
                { ...state, lastId: state.lastId + 1 },
                target.group,
                target.index,
                task,
              )

              yield* ensureAcyclic(allTasks(next))

              return [task, next] as const
            }),
          ),

        update: (id, patch) =>
          transact((state) =>
            Effect.gen(function* () {
              const valid = yield* validate(TaskPatch, patch)
              const task = yield* findTask(state, id)
              const updated: Task = {
                ...task,
                title: valid.title ?? task.title,
                description: valid.description ?? task.description,
                tags: valid.tags === undefined ? task.tags : unique(valid.tags),
                assignee:
                  valid.assignee === undefined ? task.assignee : (valid.assignee ?? undefined),
                dependsOn: valid.dependsOn === undefined ? task.dependsOn : unique(valid.dependsOn),
                extra: valid.extra ?? task.extra,
              }

              const next = replaceTask(state, updated)
              yield* ensureAcyclic(allTasks(next))

              return [updated, next] as const
            }),
          ),

        move: (id, placement) =>
          transact((state) =>
            Effect.gen(function* () {
              const where = yield* validate(Placement, placement)
              const { task } = yield* findOpen(state, id, "move")

              if (where.before === id || where.after === id) {
                return yield* new ValidationError({
                  issues: [`task ${id} cannot be placed next to itself`],
                })
              }

              const rest = withoutTask(state, id)
              const target = yield* resolve(rest, where)
              const moved: Task = { ...task, group: target.group }

              return [moved, insert(rest, target.group, target.index, moved)] as const
            }),
          ),

        complete: (id) =>
          transact((state) =>
            Effect.gen(function* () {
              const { task } = yield* findOpen(state, id, "complete")
              const done: Task = {
                ...task,
                status: "done",
                outcome: "completed",
                completedAt: yield* DateTime.now,
              }

              const rest = withoutTask(state, id)

              return [done, { ...rest, done: [done, ...rest.done] }] as const
            }),
          ),

        cancel: (id, reason) =>
          options.cancel === false
            ? Effect.fail(new Unsupported({ operation: "cancel" }))
            : transact((state) =>
                Effect.gen(function* () {
                  if (reason.trim() === "") {
                    return yield* new ValidationError({
                      issues: [`cancelling task ${id} needs a reason`],
                    })
                  }

                  const { task } = yield* findOpen(state, id, "cancel")
                  const cancelled: Task = {
                    ...task,
                    status: "done",
                    outcome: "cancelled",
                    cancelledReason: reason,
                    completedAt: yield* DateTime.now,
                  }

                  const rest = withoutTask(state, id)

                  return [cancelled, { ...rest, done: [cancelled, ...rest.done] }] as const
                }),
              ),

        reopen: (id) =>
          transact((state) =>
            Effect.gen(function* () {
              const task = state.done.find((done) => done.id === id)

              if (task === undefined) {
                return yield* Effect.fail(
                  locateOpen(state, id) === undefined
                    ? new TaskNotFound({ id })
                    : new InvalidTransition({ id, status: "open", operation: "reopen" }),
                )
              }

              const group = state.sections.some(
                (section) => section.name !== undefined && section.name === task.group,
              )
                ? task.group
                : undefined

              const reopened: Task = {
                ...task,
                status: "open",
                outcome: undefined,
                cancelledReason: undefined,
                completedAt: undefined,
                group,
              }

              const rest = withoutTask(state, id)

              return [reopened, insert(rest, group, endOf(rest, group), reopened)] as const
            }),
          ),

        remove: (id) =>
          transact((state) =>
            Effect.gen(function* () {
              yield* findTask(state, id)

              return [undefined, withoutTask(state, id)] as const
            }),
          ),

        renameGroup: (from, to) =>
          transact((state) =>
            Effect.gen(function* () {
              if (!state.sections.some((section) => section.name === from)) {
                return yield* new GroupNotFound({ name: from })
              }

              const name = yield* validate(Label, to)

              if (name !== from && state.sections.some((section) => section.name === name)) {
                return yield* new ValidationError({ issues: [`group ${name} already exists`] })
              }

              const sections = state.sections.map((section) =>
                section.name === from
                  ? {
                      ...section,
                      name,
                      tasks: section.tasks.map((task) => ({ ...task, group: name })),
                    }
                  : section,
              )

              return [undefined, { ...state, sections }] as const
            }),
          ),

        comment: (id, input) =>
          transact((state) =>
            Effect.gen(function* () {
              const valid = yield* validate(CommentInput, input)
              const task = yield* findTask(state, id)
              const comment: Comment = {
                author: valid.author,
                body: valid.body,
                at: yield* DateTime.now,
              }

              return [
                comment,
                replaceTask(state, { ...task, comments: [comment, ...task.comments] }),
              ] as const
            }),
          ),

        promote: () => Effect.fail(new Unsupported({ operation: "promote" })),

        diagnostics: () => Effect.succeed([]),
      })
    }),
  )
