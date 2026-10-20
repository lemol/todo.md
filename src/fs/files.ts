import { ByteSize, Effect, FileSystem, Option, Path, type PlatformError } from "effect"
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
  /**
   * One line per path saying what is there without reading it: size, inode
   * and modification time, or `-` for a missing file. Two passes agree only
   * while every file is as it was, which is what a read that may skip the
   * files needs to know.
   */
  readonly stats: (paths: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<string>, StoreError>
  /** How many writes, removals and moves this `Files` has made: a change it made itself needs no stat to be seen. */
  readonly writes: () => number
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

    let writes = 0

    const absolute = (relative: string) => path.join(root, relative)
    const makeParent = (target: string) =>
      fs.makeDirectory(path.dirname(target), { recursive: true })

    const wrote = <A, E>(effect: Effect.Effect<A, E>) =>
      Effect.tap(effect, () => Effect.sync(() => writes++))

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

        return wrote(
          makeParent(target).pipe(
            Effect.andThen(fs.writeFileString(temporary, text)),
            Effect.andThen(fs.rename(temporary, target)),
            Effect.onError(() => Effect.ignore(fs.remove(temporary))),
            Effect.mapError(fail(`write ${relative}`)),
          ),
        )
      },
      remove: (relative) =>
        wrote(
          fs
            .remove(absolute(relative))
            .pipe(
              Effect.catch((error) =>
                isNotFound(error) ? Effect.void : Effect.fail(fail(`remove ${relative}`)(error)),
              ),
            ),
        ),
      move: (from, to) =>
        wrote(
          makeParent(absolute(to)).pipe(
            Effect.andThen(fs.rename(absolute(from), absolute(to))),
            Effect.mapError(fail(`move ${from} to ${to}`)),
          ),
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
      stats: (paths) =>
        Effect.forEach(
          paths,
          (relative) =>
            fs.stat(absolute(relative)).pipe(
              Effect.map(
                (info) =>
                  `${relative}:${ByteSize.toNumberUnsafe(info.size)}:${Option.getOrElse(info.ino, () => 0)}:${Option.match(info.mtime, { onNone: () => 0, onSome: (time) => time.getTime() })}`,
              ),
              Effect.catch((error) =>
                isNotFound(error)
                  ? Effect.succeed(`${relative}:-`)
                  : Effect.fail(fail(`stat ${relative}`)(error)),
              ),
            ),
          { concurrency: 16 },
        ),
      writes: () => writes,
    }
  })
