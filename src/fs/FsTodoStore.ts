/**
 * The reference file-system `TodoStore`: a list directory with `TODO.md`,
 * task files and a done directory (spec Part 2). Reads never write; every
 * mutation takes the lock, normalizes the list, then applies its edits.
 */

import { DateTime, Effect, type FileSystem, Layer, type Path } from "effect"
import {
  allItems,
  basename,
  dirname,
  formatLinkedItem,
  formatTaskFile,
  groupSlug,
  insertItem,
  joinPath,
  linkedItemFor,
  nextId,
  parseTodoFile,
  prependComment,
  removeItem,
  renameSection,
  replaceItem,
  setItemHead,
  type TaskFileChanges,
  type TodoFile,
  taskFileFor,
  taskPath,
  updateTaskFile,
} from "../markdown/index.ts"
import {
  allCapabilities,
  type Comment,
  CommentInput,
  ensureAcyclic,
  GroupNotFound,
  InvalidTransition,
  Label,
  Placement,
  type StoreError,
  type Task,
  type TaskId,
  TaskInput,
  TaskNotFound,
  TaskPatch,
  type TodoList,
  TodoStore,
  unique,
  ValidationError,
  validate,
} from "../spec/index.ts"
import { type Files, makeFiles } from "./files.ts"
import { type LockOptions, makeLock } from "./lock.ts"
import { type NormalizeReport, normalizeList } from "./normalization.ts"
import {
  doneTask,
  type Entry,
  entryTask,
  isInterrupted,
  readSnapshot,
  type Snapshot,
  todoPath,
} from "./snapshot.ts"
import { completeEntry, itemLinesFor } from "./writing.ts"

export interface Options {
  /** Absolute path of the list root: the directory that contains `TODO.md`. */
  readonly root: string
  readonly lock?: Partial<LockOptions>
}

/** Open entries as the model sees them: not checked and not mid-completion. */
const openEntries = (snapshot: Snapshot): ReadonlyArray<Entry> =>
  snapshot.entries.filter((entry) => !entry.item.checked && !isInterrupted(snapshot, entry))

const toList = (snapshot: Snapshot): TodoList => {
  const open = openEntries(snapshot)
  const [ungrouped, ...groups] = snapshot.todo.sections
  const tasksOf = (name: string | undefined) =>
    open.filter((entry) => entry.section.name === name).map(entryTask)
  return {
    title: snapshot.todo.title,
    description: snapshot.todo.description,
    ungrouped: ungrouped === undefined ? [] : tasksOf(undefined),
    groups: groups.map((group) => ({
      name: group.name ?? "",
      description: group.description,
      tasks: tasksOf(group.name),
    })),
  }
}

const findTask = (snapshot: Snapshot, id: TaskId): Effect.Effect<Task, TaskNotFound> => {
  const entry = snapshot.entries.find(
    (candidate) => candidate.id === id && !isInterrupted(snapshot, candidate),
  )
  if (entry !== undefined) return Effect.succeed(entryTask(entry))
  const done = snapshot.done.find((candidate) => candidate.id === id)
  return done === undefined ? Effect.fail(new TaskNotFound({ id })) : Effect.succeed(doneTask(done))
}

const findOpen = (
  snapshot: Snapshot,
  id: TaskId,
  operation: string,
): Effect.Effect<Entry, TaskNotFound | InvalidTransition> => {
  const entry = openEntries(snapshot).find((candidate) => candidate.id === id)
  if (entry !== undefined) return Effect.succeed(entry)
  const known = snapshot.done.some((d) => d.id === id) || snapshot.entries.some((e) => e.id === id)
  return Effect.fail(
    known ? new InvalidTransition({ id, status: "done", operation }) : new TaskNotFound({ id }),
  )
}

const allTasks = (snapshot: Snapshot): ReadonlyArray<Task> => [
  ...snapshot.entries.map(entryTask),
  ...snapshot.done.map(doneTask),
]

/** Resolves a placement against `todo`, which must not contain the task being placed. */
const resolve = (
  todo: TodoFile,
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
    const section = todo.sections.find((candidate) => candidate.name === placement.group)
    return Effect.succeed({ group: placement.group, index: section?.items.length ?? 0 })
  }
  for (const section of todo.sections) {
    const index = section.items.findIndex((item) => item.id === anchorId && !item.checked)
    if (index === -1) continue
    if (placement.group !== undefined && placement.group !== section.name) {
      return Effect.fail(
        new ValidationError({ issues: [`task ${anchorId} is not in group ${placement.group}`] }),
      )
    }
    return Effect.succeed({
      group: section.name,
      index: placement.before === undefined ? index + 1 : index,
    })
  }
  return Effect.fail(new TaskNotFound({ id: anchorId }))
}

const applyPatch = (task: Task, patch: TaskPatch): Task => ({
  ...task,
  title: patch.title ?? task.title,
  description: patch.description ?? task.description,
  tags: patch.tags === undefined ? task.tags : unique(patch.tags),
  assignee: patch.assignee === undefined ? task.assignee : (patch.assignee ?? undefined),
  dependsOn: patch.dependsOn === undefined ? task.dependsOn : unique(patch.dependsOn),
  extra: patch.extra ?? task.extra,
})

const changesOf = (patch: TaskPatch): TaskFileChanges => ({
  ...(patch.title === undefined ? {} : { title: patch.title }),
  ...(patch.description === undefined ? {} : { description: patch.description }),
  ...(patch.tags === undefined ? {} : { tags: unique(patch.tags) }),
  ...(patch.assignee === undefined ? {} : { assignee: patch.assignee }),
  ...(patch.dependsOn === undefined ? {} : { dependsOn: unique(patch.dependsOn) }),
  ...(patch.extra === undefined ? {} : { extra: patch.extra }),
})

/** The directory a task file of `group` lives in by convention. */
const groupDir = (tasksDir: string, group: string | undefined) =>
  dirname(taskPath(tasksDir, group, "0", "x"))

const byCompletion = (a: Task, b: Task) =>
  (b.completedAt === undefined ? 0 : DateTime.toEpochMillis(b.completedAt)) -
  (a.completedAt === undefined ? 0 : DateTime.toEpochMillis(a.completedAt))

const makeStore = (files: Files, options: Options) =>
  Effect.gen(function* () {
    const lock = yield* makeLock(files.root, options.lock)
    const read = readSnapshot(files)
    const writeTodo = (text: string) => files.write(todoPath, text)

    /** Runs `f` under the lock, on a freshly normalized snapshot (spec §2.11). */
    const mutate = <A, E>(f: (snapshot: Snapshot) => Effect.Effect<A, E>) =>
      lock(normalizeList(files).pipe(Effect.andThen(read), Effect.flatMap(f)))

    return TodoStore.of({
      capabilities: allCapabilities,

      load: () => Effect.map(read, toList),

      get: (id) => Effect.flatMap(read, (snapshot) => findTask(snapshot, id)),

      listDone: () =>
        Effect.map(read, (snapshot) => [
          ...snapshot.entries
            .filter((entry) => entry.item.checked && !isInterrupted(snapshot, entry))
            .map(entryTask),
          ...snapshot.done.map(doneTask).sort(byCompletion),
        ]),

      add: (input, placement = {}) =>
        Effect.all([validate(TaskInput, input), validate(Placement, placement)]).pipe(
          Effect.flatMap(([valid, where]) =>
            mutate((snapshot) =>
              Effect.gen(function* () {
                const target = yield* resolve(snapshot.todo, where)
                const task: Task = {
                  id: nextId(snapshot.usedIds),
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
                yield* ensureAcyclic([...allTasks(snapshot), task])
                const lines = yield* itemLinesFor(files, snapshot.todo.config, task)
                yield* writeTodo(insertItem(snapshot.todo, target.group, target.index, lines))
                return task
              }),
            ),
          ),
        ),

      update: (id, patch) =>
        validate(TaskPatch, patch).pipe(
          Effect.flatMap((valid) =>
            mutate((snapshot) =>
              Effect.gen(function* () {
                const updated = applyPatch(yield* findTask(snapshot, id), valid)
                yield* ensureAcyclic(
                  allTasks(snapshot).map((task) => (task.id === id ? updated : task)),
                )
                const done = snapshot.done.find((candidate) => candidate.id === id)
                if (done !== undefined) {
                  yield* files.write(done.path, updateTaskFile(done.source, changesOf(valid)))
                  return updated
                }
                const entry = snapshot.entries.find((candidate) => candidate.id === id)
                if (entry === undefined) return yield* new TaskNotFound({ id })
                const { item } = entry
                if (!item.linked) {
                  const lines = yield* itemLinesFor(files, snapshot.todo.config, updated)
                  yield* writeTodo(replaceItem(snapshot.todo, item, lines))
                } else if (item.path !== undefined) {
                  yield* files.write(
                    item.path,
                    entry.source === undefined
                      ? formatTaskFile(taskFileFor(updated))
                      : updateTaskFile(entry.source, changesOf(valid)),
                  )
                  if (updated.title !== item.title) {
                    yield* writeTodo(setItemHead(snapshot.todo, item, id, updated.title))
                  }
                }
                return updated
              }),
            ),
          ),
        ),

      move: (id, placement) =>
        validate(Placement, placement).pipe(
          Effect.flatMap((where) =>
            mutate((snapshot) =>
              Effect.gen(function* () {
                const entry = yield* findOpen(snapshot, id, "move")
                if (where.before === id || where.after === id) {
                  return yield* new ValidationError({
                    issues: [`task ${id} cannot be placed next to itself`],
                  })
                }
                const { item } = entry
                const rest = parseTodoFile(removeItem(snapshot.todo, item))
                const target = yield* resolve(rest, where)
                const task: Task = { ...entryTask(entry), group: target.group }
                let lines = snapshot.todo.text.lines.slice(item.start, item.end)
                const { tasksDir } = snapshot.todo.config
                if (
                  target.group !== entry.section.name &&
                  item.linked &&
                  item.path !== undefined &&
                  dirname(item.path) === groupDir(tasksDir, entry.section.name)
                ) {
                  const path = joinPath(groupDir(tasksDir, target.group), basename(item.path))
                  yield* files.move(item.path, path)
                  lines = linkedItemFor(task, path)
                }
                yield* writeTodo(insertItem(rest, target.group, target.index, lines))
                return task
              }),
            ),
          ),
        ),

      complete: (id) =>
        mutate((snapshot) =>
          findOpen(snapshot, id, "complete").pipe(
            Effect.flatMap((entry) => completeEntry(files, snapshot, entry)),
          ),
        ),

      reopen: (id) =>
        mutate((snapshot) =>
          Effect.gen(function* () {
            const done = snapshot.done.find((candidate) => candidate.id === id)
            if (done === undefined) {
              return yield* Effect.fail(
                snapshot.entries.some((entry) => entry.id === id)
                  ? new InvalidTransition({ id, status: "open", operation: "reopen" })
                  : new TaskNotFound({ id }),
              )
            }
            const task = doneTask(done)
            const section = snapshot.todo.sections.find(
              (candidate) => candidate.name !== undefined && candidate.name === task.group,
            )
            const group = section?.name
            const reopened: Task = { ...task, status: "open", completedAt: undefined, group }
            const path = taskPath(snapshot.todo.config.tasksDir, group, id, reopened.title)
            // The done file is the commit point, so it is deleted last (spec §2.10).
            const end = (section ?? snapshot.todo.sections[0])?.items.length ?? 0
            yield* writeTodo(insertItem(snapshot.todo, group, end, linkedItemFor(reopened, path)))
            yield* files.write(
              path,
              updateTaskFile(done.source, { group: null, completedAt: null }),
            )
            yield* files.remove(done.path)
            return reopened
          }),
        ),

      remove: (id) =>
        mutate((snapshot) =>
          Effect.gen(function* () {
            const entry = snapshot.entries.find((candidate) => candidate.id === id)
            if (entry !== undefined) {
              yield* writeTodo(removeItem(snapshot.todo, entry.item))
              if (entry.item.linked && entry.item.path !== undefined)
                yield* files.remove(entry.item.path)
              return
            }
            const done = snapshot.done.find((candidate) => candidate.id === id)
            if (done === undefined) return yield* new TaskNotFound({ id })
            yield* files.remove(done.path)
          }),
        ),

      renameGroup: (from, to) =>
        mutate((snapshot) =>
          Effect.gen(function* () {
            const section = snapshot.todo.sections.find(
              (candidate) => candidate.name !== undefined && candidate.name === from,
            )
            if (section === undefined) return yield* new GroupNotFound({ name: from })
            const name = yield* validate(Label, to)
            if (name === from) return
            const taken = snapshot.todo.sections.some(
              (other) =>
                other !== section &&
                other.name !== undefined &&
                (other.name === name || groupSlug(other.name) === groupSlug(name)),
            )
            if (taken)
              return yield* new ValidationError({ issues: [`group ${name} already exists`] })

            const { tasksDir } = snapshot.todo.config
            const oldDir = groupDir(tasksDir, from)
            const newDir = groupDir(tasksDir, name)
            let text = renameSection(snapshot.todo, from, name)
            if (oldDir !== newDir && (yield* files.exists(oldDir))) {
              const moveWhole = !(yield* files.exists(newDir))
              if (moveWhole) yield* files.move(oldDir, newDir)
              while (true) {
                const todo = parseTodoFile(text)
                const item = allItems(todo).find((candidate) =>
                  candidate.path?.startsWith(`${oldDir}/`),
                )
                if (item?.path === undefined || item.id === undefined) break
                const path = `${newDir}/${item.path.slice(oldDir.length + 1)}`
                if (!moveWhole) yield* files.move(item.path, path)
                text = replaceItem(
                  todo,
                  item,
                  formatLinkedItem({ id: item.id, title: item.title, path }),
                )
              }
            }
            yield* writeTodo(text)
          }),
        ),

      comment: (id, input) =>
        validate(CommentInput, input).pipe(
          Effect.flatMap((valid) =>
            mutate((snapshot) =>
              Effect.gen(function* () {
                const task = yield* findTask(snapshot, id)
                const comment: Comment = {
                  author: valid.author,
                  body: valid.body,
                  at: yield* DateTime.now,
                }
                const done = snapshot.done.find((candidate) => candidate.id === id)
                const entry = snapshot.entries.find((candidate) => candidate.id === id)
                if (done !== undefined) {
                  yield* files.write(done.path, prependComment(done.source, comment))
                } else if (
                  entry?.item.linked &&
                  entry.item.path !== undefined &&
                  entry.source !== undefined
                ) {
                  yield* files.write(entry.item.path, prependComment(entry.source, comment))
                } else if (entry !== undefined) {
                  // An inline task, or a link to a missing file: (re)write the file with the comment.
                  const withComment: Task = { ...task, comments: [comment, ...task.comments] }
                  const path = entry.item.linked ? entry.item.path : undefined
                  const lines = yield* itemLinesFor(files, snapshot.todo.config, withComment, path)
                  if (!entry.item.linked)
                    yield* writeTodo(replaceItem(snapshot.todo, entry.item, lines))
                }
                return comment
              }),
            ),
          ),
        ),

      promote: (id) =>
        mutate((snapshot) =>
          Effect.gen(function* () {
            const task = yield* findTask(snapshot, id)
            // A linked item already has its file, and a done task lives in its
            // done file: either way there is nothing left to promote (§2.9).
            const entry = snapshot.entries.find((candidate) => candidate.id === id)
            if (entry === undefined || entry.item.linked) return task
            const path = taskPath(snapshot.todo.config.tasksDir, task.group, task.id, task.title)
            const lines = yield* itemLinesFor(files, snapshot.todo.config, task, path)
            yield* writeTodo(replaceItem(snapshot.todo, entry.item, lines))
            return task
          }),
        ),

      diagnostics: () => Effect.map(read, (snapshot) => snapshot.diagnostics),
    })
  })

/** A `TodoStore` over the list at `options.root`. */
export const layer = (
  options: Options,
): Layer.Layer<TodoStore, never, FileSystem.FileSystem | Path.Path> =>
  Layer.effect(
    TodoStore,
    Effect.flatMap(makeFiles(options.root), (files) => makeStore(files, options)),
  )

/** Normalizes the list at `root` on request, holding the lock (spec §2.11). Backs `todo fmt`. */
export const normalize = (
  root: string,
  lock?: Partial<LockOptions>,
): Effect.Effect<NormalizeReport, StoreError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const files = yield* makeFiles(root)
    const withLock = yield* makeLock(root, lock)
    return yield* withLock(normalizeList(files))
  })
