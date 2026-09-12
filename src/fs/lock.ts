import { Clock, Duration, Effect, FileSystem, Option, Path, type PlatformError } from "effect"
import { StoreError } from "../spec/index.ts"

export interface LockOptions {
  /** How long to wait for another process's lock before failing. */
  readonly timeout: Duration.Input
  /** A lock file older than this was left by a crashed process and is taken over. */
  readonly staleAfter: Duration.Input
  /** How long to wait between attempts. */
  readonly retryEvery: Duration.Input
}

export const defaultLockOptions: LockOptions = {
  timeout: "10 seconds",
  staleAfter: "30 seconds",
  retryEvery: "50 millis",
}

export const lockFile = ".todo.lock"

/** Runs an effect while holding the list's lock. */
export type Lock = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | StoreError, R>

const alreadyExists = (error: PlatformError.PlatformError) => error.reason._tag === "AlreadyExists"

const newToken = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

/**
 * The list's advisory lock: `<root>/.todo.lock`, created exclusively, so
 * concurrent processes (typically agents) cannot lose each other's writes.
 * The lock is released however the locked effect ends.
 */
export const makeLock = (
  root: string,
  options?: Partial<LockOptions>,
): Effect.Effect<Lock, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const opts: LockOptions = { ...defaultLockOptions, ...options }
    const fs = yield* FileSystem.FileSystem
    const lock = (yield* Path.Path).join(root, lockFile)
    const failure = (error: PlatformError.PlatformError) =>
      new StoreError({ message: `could not lock the list: ${error.message}`, cause: error })

    const acquire = Effect.gen(function* () {
      const deadline = (yield* Clock.currentTimeMillis) + Duration.toMillis(opts.timeout)
      const token = newToken()
      while (true) {
        const created = yield* fs.writeFileString(lock, token, { flag: "wx" }).pipe(
          Effect.as(true),
          Effect.catch((error) =>
            alreadyExists(error) ? Effect.succeed(false) : Effect.fail(failure(error)),
          ),
        )
        if (created) return token
        const now = yield* Clock.currentTimeMillis
        const modified = Option.flatMap(yield* Effect.option(fs.stat(lock)), (info) => info.mtime)
        const age = Option.isSome(modified) ? now - modified.value.getTime() : 0
        if (age > Duration.toMillis(opts.staleAfter)) {
          yield* Effect.ignore(fs.remove(lock))
          continue
        }
        if (now >= deadline) {
          return yield* new StoreError({
            message: `the list is locked by another process (${lock})`,
          })
        }
        yield* Effect.sleep(opts.retryEvery)
      }
    })

    const release = (token: string) =>
      Effect.gen(function* () {
        const current = yield* Effect.option(fs.readFileString(lock))
        if (Option.isSome(current) && current.value === token) {
          yield* Effect.ignore(fs.remove(lock))
        }
      }).pipe(Effect.ignore)

    return (effect) => Effect.acquireUseRelease(acquire, () => effect, release)
  })
