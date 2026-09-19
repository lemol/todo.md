import { Effect, FileSystem, Layer, Option, Path, type PlatformError, Schema, Stream } from "effect"
import { FsTodoStore, lockFile } from "../../fs/index.ts"
import { SourceError } from "../errors.ts"
import { nameForList } from "../names.ts"
import type { Source, SourceEnv, SourceProject } from "../Source.ts"

export const FsConfig = Schema.Struct({
  path: Schema.String.check(
    Schema.makeFilter((path: string) => path.startsWith("/") || "must be an absolute path"),
  ),
})
export type FsConfig = typeof FsConfig.Type

/** The list under `path`: `path/todo` if it has a `TODO.md`, else `path` if it has one. No walking up. */
export const listRootOf = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const paths = yield* Path.Path
    const dir = paths.resolve(path)
    for (const root of [paths.join(dir, "todo"), dir]) {
      if (yield* fs.exists(paths.join(root, "TODO.md"))) return Option.some(root)
    }
    return Option.none<string>()
  })

export interface WatchListOptions {
  /**
   * Further event paths to skip, such as git's `.git` directory when the list
   * is a repository root. The path is as the watcher reports it.
   */
  readonly ignore?: (path: string) => boolean
}

/**
 * Emits once each burst of changes under `root` settles (100 ms), ignoring
 * the lock file and temporary files. Fails when `root` cannot be watched.
 */
export const watchList = (
  root: string,
  options: WatchListOptions = {},
): Stream.Stream<void, PlatformError.PlatformError, SourceEnv> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      // Event paths may be relative to `root`; only the file name matters,
      // except for `options.ignore`, which sees the path as reported.
      return fs.watch(root, { recursive: true }).pipe(
        Stream.filter((event) => {
          const name = path.basename(event.path)
          if (name === lockFile || name.endsWith(".tmp")) return false
          return options.ignore === undefined || !options.ignore(event.path)
        }),
        Stream.debounce("100 millis"),
        Stream.map(() => undefined),
      )
    }),
  )

/** The list's changes; a missing or unwatchable list ends the stream with a warning. */
const changesOf = (project: SourceProject<FsConfig>): Stream.Stream<void, never, SourceEnv> => {
  const stop = (reason: string) =>
    Stream.drain(
      Stream.fromEffect(Effect.logWarning(`stopped watching ${project.name}: ${reason}`)),
    )
  return Stream.unwrap(
    Effect.gen(function* () {
      const root = yield* listRootOf(project.config.path)
      const changes: Stream.Stream<void, PlatformError.PlatformError, SourceEnv> = Option.isSome(
        root,
      )
        ? watchList(root.value)
        : stop(`no TODO.md at ${project.config.path}`)
      return changes
    }),
  ).pipe(Stream.catch((error) => stop(error.message)))
}

/** A list in a local directory: `{ path }`, the project directory or the list directory itself. */
export const fsSource: Source<FsConfig> = {
  kind: "fs",
  config: FsConfig,
  defaultName: (config) => nameForList(config.path),
  location: (config) => config.path,
  open: (project) =>
    Layer.unwrap(
      Effect.gen(function* () {
        const root = yield* listRootOf(project.config.path).pipe(
          Effect.mapError(
            (error) =>
              new SourceError({
                name: project.name,
                message: `could not look for a list at ${project.config.path}: ${error.message}`,
                cause: error,
              }),
          ),
        )
        if (Option.isNone(root)) {
          return yield* new SourceError({
            name: project.name,
            message: `no TODO.md at ${project.config.path}`,
          })
        }
        return FsTodoStore.layer({ root: root.value })
      }),
    ),
  changes: changesOf,
  owns: (config, listRoot) =>
    listRootOf(config.path).pipe(
      Effect.map(Option.contains(listRoot)),
      Effect.orElseSucceed(() => false),
    ),
}
