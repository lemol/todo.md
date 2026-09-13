import { DateTime, Effect, Result, Semaphore } from "effect"
import type { HubChange } from "./changes.ts"
import type { SyncError } from "./errors.ts"
import { type Project, sourceProjectOf } from "./projects.ts"
import type { AnySource, SourceEnv } from "./Source.ts"
import { writeState } from "./state.ts"

/** A successful `sync`. */
export interface SyncResult {
  readonly project: string
  /** One line for people, e.g. "pulled 3 commits, pushed 1". */
  readonly summary: string
  readonly ahead?: number
  readonly behind?: number
  readonly at: DateTime.Utc
}

/** A project that failed in `syncAll`. Tell it from a `SyncResult` with `"error" in outcome`. */
export interface SyncFailure {
  readonly project: string
  readonly error: SyncError
}

export const nothingToSync = "nothing to sync"

/**
 * Syncs projects one at a time per project name, records each outcome in the
 * project's `state.json` and publishes `synced`. A failed state write is
 * logged; it never changes the outcome.
 */
export const makeSyncer = (publish: (change: HubChange) => Effect.Effect<void>) => {
  const locks = new Map<string, Semaphore.Semaphore>()
  const lockOf = (name: string) => {
    const existing = locks.get(name)
    if (existing !== undefined) return existing
    const lock = Semaphore.makeUnsafe(1)
    locks.set(name, lock)
    return lock
  }

  return (
    project: Project,
    source: AnySource,
    config: unknown,
  ): Effect.Effect<SyncResult, SyncError, SourceEnv> => {
    const { name } = project
    if (source.sync === undefined) {
      return Effect.map(DateTime.now, (at) => ({ project: name, summary: nothingToSync, at }))
    }
    const sync = source.sync(sourceProjectOf(project, config))
    return lockOf(name).withPermit(
      Effect.gen(function* () {
        const outcome = yield* Effect.result(sync)
        const at = yield* DateTime.now
        if (project.dir !== undefined) {
          const state = Result.isSuccess(outcome)
            ? { lastSync: at, result: "ok" as const, diverged: false }
            : {
                lastSync: at,
                result: "error" as const,
                error: outcome.failure.message,
                diverged: outcome.failure.reason === "diverged",
              }
          yield* writeState(project.dir, state).pipe(
            Effect.catch((error) =>
              Effect.logWarning(`could not record the sync of ${name}: ${error.message}`),
            ),
          )
        }
        yield* publish({ kind: "synced", project: name })
        if (Result.isFailure(outcome)) return yield* outcome.failure
        return { project: name, at, ...outcome.success }
      }),
    )
  }
}
