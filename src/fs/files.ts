import { Effect, FileSystem, Path, type PlatformError } from "effect"
import { StoreError } from "../spec/index.ts"

/**
 * File access for one list, by root-relative path. Every failure becomes a
 * `StoreError`; a missing file is not a failure where the caller can expect it.
 */
export interface Files {
  readonly root: string
  /** The file's text, or `undefined` if it does not exist. */
  readonly read: (path: string) => Effect.Effect<string | undefined, StoreError>
  /** Writes atomically (temporary file, then rename), creating directories as needed. */
  readonly write: (path: string, text: string) => Effect.Effect<void, StoreError>
  /** Deletes a file; a missing file is fine. */
  readonly remove: (path: string) => Effect.Effect<void, StoreError>
  /** Moves a file or directory, creating the target's parent directories. */
  readonly move: (from: string, to: string) => Effect.Effect<void, StoreError>
  readonly exists: (path: string) => Effect.Effect<boolean, StoreError>
  /** Root-relative paths of the entries in `dir` (all files below it when `recursive`); `[]` if it is missing. */
  readonly list: (
    dir: string,
    options?: { readonly recursive?: boolean },
  ) => Effect.Effect<ReadonlyArray<string>, StoreError>
}

const isNotFound = (error: PlatformError.PlatformError): boolean => error.reason._tag === "NotFound"

const fail = (action: string) => (error: PlatformError.PlatformError) =>
  new StoreError({ message: `could not ${action}: ${error.message}`, cause: error })

export const makeFiles = (
  root: string,
): Effect.Effect<Files, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const absolute = (relative: string) => path.join(root, relative)
    const makeParent = (target: string) =>
      fs.makeDirectory(path.dirname(target), { recursive: true })

    return {
      root,
      read: (relative) =>
        fs
          .readFileString(absolute(relative))
          .pipe(
            Effect.catch((error) =>
              isNotFound(error)
                ? Effect.succeed(undefined)
                : Effect.fail(fail(`read ${relative}`)(error)),
            ),
          ),
      write: (relative, text) => {
        const target = absolute(relative)
        const temporary = `${target}.${Math.random().toString(36).slice(2)}.tmp`
        return makeParent(target).pipe(
          Effect.andThen(fs.writeFileString(temporary, text)),
          Effect.andThen(fs.rename(temporary, target)),
          Effect.onError(() => Effect.ignore(fs.remove(temporary))),
          Effect.mapError(fail(`write ${relative}`)),
        )
      },
      remove: (relative) =>
        fs
          .remove(absolute(relative))
          .pipe(
            Effect.catch((error) =>
              isNotFound(error) ? Effect.void : Effect.fail(fail(`remove ${relative}`)(error)),
            ),
          ),
      move: (from, to) =>
        makeParent(absolute(to)).pipe(
          Effect.andThen(fs.rename(absolute(from), absolute(to))),
          Effect.mapError(fail(`move ${from} to ${to}`)),
        ),
      exists: (relative) =>
        fs.exists(absolute(relative)).pipe(Effect.mapError(fail(`check ${relative}`))),
      list: (dir, options) =>
        fs.readDirectory(absolute(dir), { recursive: options?.recursive ?? false }).pipe(
          Effect.map((entries) =>
            entries.map((entry) => path.join(dir, entry).split(path.sep).join("/")).sort(),
          ),
          Effect.catch((error) =>
            isNotFound(error) ? Effect.succeed([]) : Effect.fail(fail(`list ${dir}`)(error)),
          ),
        ),
    }
  })
