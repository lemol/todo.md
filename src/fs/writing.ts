import { DateTime, Effect } from "effect"
import {
  fitsInline,
  formatTaskFile,
  inlineItemFor,
  type ListConfig,
  linkedItemFor,
  removeItem,
  taskFileFor,
  taskPath,
  updateTaskFile,
} from "../markdown/index.ts"
import type { StoreError, Task } from "../spec/index.ts"
import type { Files } from "./files.ts"
import { type Entry, entryTask, type Snapshot, todoPath } from "./snapshot.ts"

/**
 * The `TODO.md` lines for an open task. A task that cannot stay inline, or
 * already has a file at `path`, gets its task file (re)written (spec §2.9).
 */
export const itemLinesFor = (
  files: Files,
  config: ListConfig,
  task: Task,
  path?: string,
): Effect.Effect<string[], StoreError> =>
  Effect.gen(function* () {
    if (path === undefined && fitsInline(task)) return inlineItemFor(task)

    const target = path ?? taskPath(config.tasksDir, task.group, task.id, task.title)

    yield* files.write(target, formatTaskFile(taskFileFor(task)))

    return linkedItemFor(task, target)
  })

/**
 * Completes an entry in the order spec §2.10 requires: write the done file
 * (the commit point), delete the original task file, then remove the item.
 */
export const completeEntry = (
  files: Files,
  snapshot: Snapshot,
  entry: Entry,
): Effect.Effect<Task, StoreError> =>
  Effect.gen(function* () {
    const group = entry.section.name
    const done: Task = {
      ...entryTask(entry),
      status: "done",
      outcome: "completed",
      completedAt: yield* DateTime.now,
      group,
    }

    const donePath = taskPath(snapshot.todo.config.doneDir, group, entry.id, done.title)
    const source =
      entry.source === undefined
        ? formatTaskFile(taskFileFor(done))
        : updateTaskFile(entry.source, {
            group: group ?? null,
            completedAt: done.completedAt ?? null,
            outcome: "completed",
            ...(entry.file?.title === undefined ? { title: done.title } : {}),
          })

    yield* files.write(donePath, source)
    const original = entry.item.path

    if (entry.item.linked && original !== undefined && original !== donePath) {
      yield* files.remove(original)
    }

    yield* files.write(todoPath, removeItem(snapshot.todo, entry.item))

    return done
  })

/**
 * Cancels an entry. Identical to `completeEntry` in file order (spec §2.10);
 * what differs is the outcome and the recorded reason.
 */
export const cancelEntry = (
  files: Files,
  snapshot: Snapshot,
  entry: Entry,
  reason: string,
): Effect.Effect<Task, StoreError> =>
  Effect.gen(function* () {
    const group = entry.section.name
    const cancelled: Task = {
      ...entryTask(entry),
      status: "done",
      outcome: "cancelled",
      cancelledReason: reason,
      completedAt: yield* DateTime.now,
      group,
    }

    const donePath = taskPath(snapshot.todo.config.doneDir, group, entry.id, cancelled.title)
    const source =
      entry.source === undefined
        ? formatTaskFile(taskFileFor(cancelled))
        : updateTaskFile(entry.source, {
            group: group ?? null,
            completedAt: cancelled.completedAt ?? null,
            outcome: "cancelled",
            cancelledReason: reason,
            ...(entry.file?.title === undefined ? { title: cancelled.title } : {}),
          })

    yield* files.write(donePath, source)
    const original = entry.item.path

    if (entry.item.linked && original !== undefined && original !== donePath) {
      yield* files.remove(original)
    }

    yield* files.write(todoPath, removeItem(snapshot.todo, entry.item))

    return cancelled
  })
