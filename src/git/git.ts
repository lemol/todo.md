/**
 * Running `git`. Everything the source does goes through `Git`, so
 * credentials stay in the user's own setup (ssh agent, credential helpers)
 * and nothing is stored here.
 */

import { Effect, Schema, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

/** A `git` invocation that failed; `code` is -1 when git could not be started. */
export class GitError extends Schema.TaggedError<GitError>()("GitError", {
  args: Schema.Array(Schema.String),
  code: Schema.Number,
  stderr: Schema.String,
}) {
  override get message() {
    const detail = this.stderr === "" ? "no output" : this.stderr

    return `git ${this.args.join(" ")} failed (${this.code}): ${detail}`
  }
}

/** Runs `git <args>` in `cwd` and returns its stdout. */
export type Git = (cwd: string, args: ReadonlyArray<string>) => Effect.Effect<string, GitError>

export interface GitOptions {
  /**
   * The parent environment. Only `GIT_SSH_COMMAND` is read: a user who set one
   * keeps it, and everyone else gets ssh in batch mode.
   */
  readonly env?: Readonly<Record<string, string | undefined>>
}

/** ssh that fails instead of asking for a password or a host key. */
export const batchModeSsh = "ssh -o BatchMode=yes"

/**
 * A `Git` over `ChildProcessSpawner`. Every call runs with prompting off: a
 * CLI that blocks on a password nobody can type would hang forever, and the
 * hub's mutations must not wait on the network either.
 */
export const makeGit = (
  options: GitOptions = {},
): Effect.Effect<Git, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const env: Record<string, string> = {
      GIT_TERMINAL_PROMPT: "0",
      ...(options.env?.GIT_SSH_COMMAND === undefined ? { GIT_SSH_COMMAND: batchModeSsh } : {}),
    }

    return (cwd, args) =>
      Effect.gen(function* () {
        const handle = yield* spawner.spawn(
          ChildProcess.make("git", [...args], { cwd, env, extendEnv: true }),
        )

        // Both pipes are drained while the process runs: waiting for the exit
        // code first would deadlock on a command with a lot of output.
        const [stdout, stderr, code] = yield* Effect.all(
          [
            Stream.mkString(Stream.decodeText(handle.stdout)),
            Stream.mkString(Stream.decodeText(handle.stderr)),
            handle.exitCode,
          ],
          { concurrency: "unbounded" },
        )

        if (code !== 0) return yield* new GitError({ args, code, stderr: stderr.trim() })

        return stdout
      }).pipe(
        Effect.scoped,
        Effect.catchTag(
          "PlatformError",
          (cause) => new GitError({ args, code: -1, stderr: cause.message }),
        ),
      )
  })
