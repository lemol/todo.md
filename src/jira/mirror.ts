/**
 * `<dir>/mirror.json`: the local replica of a Jira project.
 *
 * Every read goes through it, so a list still opens offline and a `todo ls`
 * costs no request. `sync` replaces it, and each store mutation patches the
 * one issue it changed. Both hold `<dir>/.todo.lock` while they write.
 */

import { DateTime, Effect, FileSystem, Option, Path, Random, Schema } from "effect"
import type { SourceEnv } from "../hub/index.ts"
import { makeLock, StoreError, Task } from "../spec/index.ts"

export const mirrorFile = "mirror.json"

/** The mirror's contents: the two queries' results, in the model's encoded form. */
export const Mirror = Schema.Struct({
  version: Schema.Literal(1),
  syncedAt: Schema.DateTimeUtc,
  open: Schema.Array(Task),
  done: Schema.Array(Task),
  /**
   * When each issue was last patched by a mutation. A sync that started
   * earlier fetched it before the change, so it keeps the patched copy.
   */
  patched: Schema.optional(Schema.Record(Schema.String, Schema.DateTimeUtc)),
})
export type Mirror = typeof Mirror.Type

const MirrorJson = Schema.fromJsonString(Schema.toCodecJson(Mirror))

const fileIn = (dir: string) => Effect.map(Path.Path, (path) => path.join(dir, mirrorFile))

/** The mirror, or `None` when the project has never been synced. */
export const readMirror = (
  dir: string,
): Effect.Effect<Option.Option<Mirror>, StoreError, SourceEnv> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const file = yield* fileIn(dir)
    const text = yield* fs.readFileString(file).pipe(
      Effect.map(Option.some),
      Effect.catch((error) =>
        error.reason._tag === "NotFound"
          ? Effect.succeed(Option.none<string>())
          : Effect.fail(
              new StoreError({ message: `could not read ${file}: ${error.message}`, cause: error }),
            ),
      ),
    )

    if (Option.isNone(text)) return Option.none<Mirror>()

    return yield* Schema.decodeUnknownEffect(MirrorJson)(text.value).pipe(
      Effect.map(Option.some),
      Effect.mapError(
        (error) =>
          new StoreError({
            message: `${file} is not a usable mirror: ${error.message}`,
            cause: error,
          }),
      ),
    )
  })

/** Replaces the mirror atomically: a crash mid-write leaves the old one readable. */
const write = (dir: string, mirror: Mirror): Effect.Effect<void, StoreError, SourceEnv> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const file = yield* fileIn(dir)
    const text = yield* Schema.encodeEffect(MirrorJson)(mirror).pipe(
      Effect.mapError(
        (error) =>
          new StoreError({
            message: `could not encode the mirror: ${error.message}`,
            cause: error,
          }),
      ),
    )

    const token = yield* Random.nextIntBetween(0, Number.MAX_SAFE_INTEGER)
    const temporary = `${file}.${token.toString(36)}.tmp`

    yield* fs.makeDirectory(dir, { recursive: true }).pipe(
      Effect.andThen(fs.writeFileString(temporary, `${text}\n`)),
      Effect.andThen(fs.rename(temporary, file)),
      Effect.onError(() => Effect.ignore(fs.remove(temporary))),
      Effect.mapError(
        (error) =>
          new StoreError({ message: `could not write ${file}: ${error.message}`, cause: error }),
      ),
    )
  })

/** `task` on the side its status says: in place when it stays open, by `completedAt` when done. */
export const placed = (mirror: Mirror, task: Task): Mirror => {
  const others = (tasks: ReadonlyArray<Task>) => tasks.filter((one) => one.id !== task.id)

  if (task.status === "open") {
    const at = mirror.open.findIndex((one) => one.id === task.id)
    const open =
      at === -1 ? [...mirror.open, task] : mirror.open.map((one, i) => (i === at ? task : one))

    return { ...mirror, open, done: others(mirror.done) }
  }

  const done = others(mirror.done)

  const completed = (one: Task) =>
    one.completedAt === undefined ? 0 : DateTime.toEpochMillis(one.completedAt)

  const at = done.findIndex((one) => completed(one) < completed(task))

  return {
    ...mirror,
    open: others(mirror.open),
    done: at === -1 ? [...done, task] : [...done.slice(0, at), task, ...done.slice(at)],
  }
}

const locked = <A, E>(dir: string, effect: Effect.Effect<A, E, SourceEnv>) =>
  Effect.gen(function* () {
    yield* Effect.flatMap(FileSystem.FileSystem, (fs) =>
      fs.makeDirectory(dir, { recursive: true }),
    ).pipe(
      Effect.mapError(
        (error) =>
          new StoreError({ message: `could not create ${dir}: ${error.message}`, cause: error }),
      ),
    )
    const lock = yield* makeLock(dir)

    return yield* lock(effect)
  })

/**
 * Patches one task into the mirror under the lock, re-reading it first so a
 * sync that wrote in the meantime is not undone. A project never synced has
 * no mirror to patch.
 */
export const patchMirror = (dir: string, task: Task): Effect.Effect<void, StoreError, SourceEnv> =>
  locked(
    dir,
    Effect.gen(function* () {
      const current = yield* readMirror(dir)

      if (Option.isNone(current)) return

      const now = yield* DateTime.now
      const next = placed(current.value, task)

      yield* write(dir, { ...next, patched: { ...current.value.patched, [task.id]: now } })
    }),
  )

/**
 * Replaces the mirror with a sync's results, under the lock. An issue patched
 * since `startedAt` keeps its patched copy: the sync fetched it before the
 * change, and writing that would lose it until the next sync.
 */
export const writeMirror = (
  dir: string,
  mirror: Mirror,
  startedAt: DateTime.Utc = mirror.syncedAt,
): Effect.Effect<void, StoreError, SourceEnv> =>
  locked(
    dir,
    Effect.gen(function* () {
      // A sync is what repairs a broken mirror, so an unreadable one counts as none.
      const current = Option.getOrUndefined(
        yield* readMirror(dir).pipe(Effect.orElseSucceed(() => Option.none<Mirror>())),
      )

      const newer = Object.entries(current?.patched ?? {}).filter(([, at]) =>
        DateTime.isGreaterThanOrEqualTo(at, startedAt),
      )

      const known = new Map(
        [...(current?.open ?? []), ...(current?.done ?? [])].map((task) => [task.id, task]),
      )

      const merged = newer.reduce((next, [id]) => {
        const task = known.get(id)

        return task === undefined ? next : placed(next, task)
      }, mirror)

      const { patched: _, ...rest } = merged

      yield* write(dir, newer.length === 0 ? rest : { ...rest, patched: Object.fromEntries(newer) })
    }),
  )
