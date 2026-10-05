/**
 * `<home>/projects/<name>/state.json`: the outcome of a project's last sync.
 * The hub owns this file; sources keep their own files next to it.
 */

import { Effect, FileSystem, Path, Random, Schema } from "effect"
import { type Project, sourceProjectOf } from "./projects.ts"
import type { ProjectStatus, SourceEnv } from "./Source.ts"

export const stateFile = "state.json"

export const SyncState = Schema.Struct({
  version: Schema.Literal(1),
  lastSync: Schema.optionalKey(Schema.DateTimeUtcFromString),
  result: Schema.Literals(["ok", "error", "never"]),
  error: Schema.optionalKey(Schema.String),
  diverged: Schema.optionalKey(Schema.Boolean),
})
export type SyncState = typeof SyncState.Type

const StateJson = Schema.fromJsonString(SyncState)

const never: ProjectStatus = { result: "never" }

/** The status in `<dir>/state.json`: `never` without a file (or a `dir`), `error` when unreadable. */
export const readState = (
  dir: string | undefined,
): Effect.Effect<ProjectStatus, never, SourceEnv> =>
  Effect.gen(function* () {
    if (dir === undefined) return never

    const fs = yield* FileSystem.FileSystem
    const file = (yield* Path.Path).join(dir, stateFile)

    return yield* fs.readFileString(file).pipe(
      Effect.flatMap((text) => Schema.decodeUnknownEffect(StateJson)(text)),
      Effect.map(({ version: _version, ...status }): ProjectStatus => status),
      Effect.catch((error) =>
        Effect.succeed<ProjectStatus>(
          error._tag === "PlatformError" && error.reason._tag === "NotFound"
            ? never
            : { result: "error", error: `could not read ${file}: ${error.message}` },
        ),
      ),
    )
  })

/** Replaces `<dir>/state.json` atomically, creating `dir` if needed. */
export const writeState = (dir: string, state: Omit<SyncState, "version">) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const file = (yield* Path.Path).join(dir, stateFile)
    const encoded = yield* Schema.encodeEffect(SyncState)({ version: 1, ...state })
    const token = yield* Random.nextIntBetween(0, Number.MAX_SAFE_INTEGER)
    const temporary = `${file}.${token.toString(36)}.tmp`

    yield* fs.makeDirectory(dir, { recursive: true })
    yield* fs.writeFileString(temporary, `${JSON.stringify(encoded, null, 2)}\n`).pipe(
      Effect.andThen(fs.rename(temporary, file)),
      Effect.onError(() => Effect.ignore(fs.remove(temporary))),
    )
  })

/**
 * A project's status: its state file, overlaid with the source's live fields
 * (such as git's `ahead`). A failing `source.status` is logged and left out;
 * a broken entry's status is its problem.
 */
export const statusOf = (project: Project): Effect.Effect<ProjectStatus, never, SourceEnv> =>
  Effect.gen(function* () {
    const { config } = project

    if (config._tag === "Invalid") {
      return { result: "error" as const, error: config.problem.message }
    }

    const persisted = yield* readState(project.dir)

    if (config.source.status === undefined) return persisted

    const live = yield* config.source
      .status(sourceProjectOf(project, config.value))
      .pipe(
        Effect.catchDefect((defect) =>
          Effect.as(
            Effect.logDebug(`could not read the live status of ${project.name}`, defect),
            {},
          ),
        ),
      )

    return { ...persisted, ...live }
  })
