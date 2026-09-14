import { BunServices } from "@effect/platform-bun"
import { Effect, FileSystem, Path } from "effect"
import { TestConsole } from "effect/testing"
import { main } from "../../src/cli/main.ts"
import { type AnySource, fsSource } from "../../src/hub/index.ts"
import { Disk } from "../fs/helpers.ts"

export interface Result {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export interface RunOptions {
  /** Working directory, relative to the test directory (default: the test directory itself). */
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly color?: boolean
  /** The hub's home directory (default: a fresh temporary directory, removed afterwards). */
  readonly home?: string
  /** The OS home directory for `~` expansion (default: the test directory). */
  readonly userHome?: string
  /** The sources the hub can open (default: `[fsSource]`). */
  readonly sources?: ReadonlyArray<AnySource>
}

const text = (lines: ReadonlyArray<unknown>) => lines.map(String).join("\n")

/** Runs `todo <args>` from the test directory and captures what it printed. */
export const runTodo = (args: ReadonlyArray<string>, options: RunOptions = {}) =>
  Effect.gen(function* () {
    const { root } = yield* Disk
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const out = (yield* TestConsole.logLines).length
    const err = (yield* TestConsole.errorLines).length
    const home = options.home ?? path.join(yield* fs.makeTempDirectory({ prefix: "todo-md-home-" }))
    const run = Effect.gen(function* () {
      return yield* main(args, {
        cwd: options.cwd === undefined ? root : `${root}/${options.cwd}`,
        env: options.env ?? {},
        username: "tester",
        color: options.color ?? false,
        home,
        userHome: options.userHome ?? root,
        sources: options.sources ?? [fsSource],
      }).pipe(Effect.provide(BunServices.layer))
    }).pipe(
      // A caller-passed home belongs to the caller; a fresh one is removed.
      Effect.ensuring(
        options.home === undefined
          ? Effect.ignore(fs.remove(home, { recursive: true }))
          : Effect.void,
      ),
    )
    const code = yield* run
    return {
      code,
      stdout: text((yield* TestConsole.logLines).slice(out)),
      stderr: text((yield* TestConsole.errorLines).slice(err)),
    } satisfies Result
  }).pipe(Effect.provide(BunServices.layer))

export const todo = (...args: ReadonlyArray<string>) => runTodo(args)
