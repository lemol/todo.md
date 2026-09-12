import { BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { TestConsole } from "effect/testing"
import { main } from "../../src/cli/main.ts"
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
}

const text = (lines: ReadonlyArray<unknown>) => lines.map(String).join("\n")

/** Runs `todo <args>` from the test directory and captures what it printed. */
export const runTodo = (args: ReadonlyArray<string>, options: RunOptions = {}) =>
  Effect.gen(function* () {
    const { root } = yield* Disk
    const out = (yield* TestConsole.logLines).length
    const err = (yield* TestConsole.errorLines).length
    const code = yield* main(args, {
      cwd: options.cwd === undefined ? root : `${root}/${options.cwd}`,
      env: options.env ?? {},
      username: "tester",
      color: options.color ?? false,
    }).pipe(Effect.provide(BunServices.layer))
    return {
      code,
      stdout: text((yield* TestConsole.logLines).slice(out)),
      stderr: text((yield* TestConsole.errorLines).slice(err)),
    } satisfies Result
  })

export const todo = (...args: ReadonlyArray<string>) => runTodo(args)
