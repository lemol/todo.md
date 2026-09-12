import { Effect, FileSystem, Option, Path } from "effect"
import { formatTodoFile } from "../markdown/index.ts"
import { StoreError } from "../spec/index.ts"
import { makeFiles } from "./files.ts"
import { todoPath } from "./snapshot.ts"

/**
 * Finds the list for `cwd`: walking up from `cwd`, the first directory level
 * with `todo/TODO.md` or `TODO.md` wins, `todo/TODO.md` first. Returns the
 * list root (the directory holding `TODO.md`).
 */
export const findListRoot = (
  cwd: string,
): Effect.Effect<Option.Option<string>, StoreError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    let dir = path.resolve(cwd)
    while (true) {
      for (const candidate of [path.join(dir, "todo"), dir]) {
        const found = yield* fs.exists(path.join(candidate, todoPath)).pipe(
          Effect.mapError(
            (error) =>
              new StoreError({
                message: `could not look for a list: ${error.message}`,
                cause: error,
              }),
          ),
        )
        if (found) return Option.some(candidate)
      }
      const parent = path.dirname(dir)
      if (parent === dir) return Option.none()
      dir = parent
    }
  })

export interface InitOptions {
  readonly title: string
  readonly description?: string
}

/** Creates a list at `dir`, creating the directory. Fails if `dir` already has a `TODO.md`. */
export const initList = (
  dir: string,
  options: InitOptions,
): Effect.Effect<void, StoreError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const files = yield* makeFiles(dir)
    if (yield* files.exists(todoPath)) {
      return yield* new StoreError({ message: `${dir} already has a ${todoPath}` })
    }
    yield* files.write(todoPath, formatTodoFile(options))
  })
