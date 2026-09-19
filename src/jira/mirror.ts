/**
 * `<dir>/mirror.json`: the local replica of a Jira project.
 *
 * Every read goes through it, so a list still opens offline and a `todo ls`
 * costs no request. `sync` replaces it; nothing else writes it.
 */

import { Effect, FileSystem, Option, Path, Random, Schema } from "effect"
import type { SourceEnv } from "../hub/index.ts"
import { StoreError, Task } from "../spec/index.ts"

export const mirrorFile = "mirror.json"

/** The mirror's contents: the two queries' results, in the model's encoded form. */
export const Mirror = Schema.Struct({
  version: Schema.Literal(1),
  syncedAt: Schema.DateTimeUtc,
  open: Schema.Array(Task),
  done: Schema.Array(Task),
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
export const writeMirror = (
  dir: string,
  mirror: Mirror,
): Effect.Effect<void, StoreError, SourceEnv> =>
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
