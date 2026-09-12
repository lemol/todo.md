import { Effect } from "effect"
import { normalize, removeItem } from "../markdown/index.ts"
import type { StoreError, TaskId } from "../spec/index.ts"
import type { Files } from "./files.ts"
import { isInterrupted, readSnapshot, todoPath } from "./snapshot.ts"
import { completeEntry } from "./writing.ts"

/** What normalization did. */
export interface NormalizeReport {
  /** IDs given to items that had none. */
  readonly assigned: ReadonlyArray<TaskId>
  /** Interrupted completions that were finished. */
  readonly finished: ReadonlyArray<TaskId>
  /** Checked items that were completed. */
  readonly swept: ReadonlyArray<TaskId>
}

/**
 * Brings a hand-edited list back to canonical state (spec §2.11): assigns IDs
 * and syncs link text, finishes interrupted completions, then completes
 * checked items. Call it while holding the lock.
 */
export const normalizeList = (files: Files): Effect.Effect<NormalizeReport, StoreError> =>
  Effect.gen(function* () {
    const first = yield* readSnapshot(files)
    const { text, assigned } = normalize(first.todo, {
      usedIds: first.usedIds,
      titles: first.titles,
    })
    if (text !== first.source) yield* files.write(todoPath, text)

    const finished: TaskId[] = []
    while (true) {
      const snapshot = yield* readSnapshot(files)
      const entry = snapshot.entries.find((candidate) => isInterrupted(snapshot, candidate))
      if (entry === undefined) break
      yield* files.write(todoPath, removeItem(snapshot.todo, entry.item))
      const leftover = entry.item.path
      if (
        entry.item.linked &&
        leftover !== undefined &&
        !snapshot.done.some((d) => d.path === leftover)
      ) {
        yield* files.remove(leftover)
      }
      finished.push(entry.id)
    }

    const swept: TaskId[] = []
    while (true) {
      const snapshot = yield* readSnapshot(files)
      const entry = snapshot.entries.find((candidate) => candidate.item.checked)
      if (entry === undefined) break
      yield* completeEntry(files, snapshot, entry)
      swept.push(entry.id)
    }
    return { assigned, finished, swept }
  })
