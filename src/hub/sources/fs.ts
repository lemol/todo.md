import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { FsTodoStore } from "../../fs/index.ts"
import { SourceError } from "../errors.ts"
import { nameForList } from "../names.ts"
import type { Source } from "../Source.ts"

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
  owns: (config, listRoot) =>
    listRootOf(config.path).pipe(
      Effect.map(Option.contains(listRoot)),
      Effect.orElseSucceed(() => false),
    ),
}
