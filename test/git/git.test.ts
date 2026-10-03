import { describe, expect } from "bun:test"
import { Effect, Layer, Sink, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { GitError, makeGit } from "../../src/git/index.ts"
import { effectTest } from "../../src/spec/testing.ts"

const bytes = (text: string) => new TextEncoder().encode(text)

interface Run {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly cwd: string | undefined
  readonly env: Readonly<Record<string, string | undefined>>
  readonly extendEnv: boolean | undefined
}

/** A spawner that answers every command the same way and records what it was asked to run. */
const recording = (answer: { code: number; stdout?: string; stderr?: string }) => {
  const runs: Run[] = []
  const layer = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.ChildProcessSpawner.of(
      ChildProcessSpawner.make((command) => {
        if (!ChildProcess.isStandardCommand(command)) return Effect.die("not a standard command")
        runs.push({
          command: command.command,
          args: command.args,
          cwd: command.options.cwd,
          env: command.options.env ?? {},
          extendEnv: command.options.extendEnv,
        })
        return Effect.succeed(
          ChildProcessSpawner.makeHandle({
            pid: ChildProcessSpawner.ProcessId(1),
            exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(answer.code)),
            isRunning: Effect.succeed(false),
            kill: () => Effect.void,
            stdin: Sink.drain,
            stdout: Stream.make(bytes(answer.stdout ?? "")),
            stderr: Stream.make(bytes(answer.stderr ?? "")),
            all: Stream.make(bytes((answer.stdout ?? "") + (answer.stderr ?? ""))),
            getInputFd: () => Sink.drain,
            getOutputFd: () => Stream.empty,
            unref: Effect.succeed(Effect.void),
          }),
        )
      }),
    ),
  )
  return { runs, layer }
}

describe("running git", () => {
  effectTest(
    "never lets git prompt, and leaves an ssh command the user set alone",
    Effect.gen(function* () {
      const fresh = recording({ code: 0 })
      const git = yield* Effect.provide(makeGit({ env: {} }), fresh.layer)
      yield* git("/work", ["status"])
      expect(fresh.runs[0]).toMatchObject({
        command: "git",
        args: ["status"],
        cwd: "/work",
        extendEnv: true,
      })
      expect(fresh.runs[0]?.env.GIT_TERMINAL_PROMPT).toBe("0")
      expect(fresh.runs[0]?.env.GIT_SSH_COMMAND).toBe("ssh -o BatchMode=yes")

      const chosen = recording({ code: 0 })
      const theirs = yield* Effect.provide(
        makeGit({ env: { GIT_SSH_COMMAND: "ssh -i /keys/id" } }),
        chosen.layer,
      )
      yield* theirs("/work", ["status"])
      expect(chosen.runs[0]?.env.GIT_TERMINAL_PROMPT).toBe("0")
      expect(chosen.runs[0]?.env.GIT_SSH_COMMAND).toBeUndefined()
    }),
  )

  effectTest(
    "returns stdout, and carries the exit code and stderr into the error",
    Effect.gen(function* () {
      const ok = recording({ code: 0, stdout: "main\n", stderr: "a warning" })
      const git = yield* Effect.provide(makeGit(), ok.layer)
      expect(yield* git("/work", ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main\n")

      const bad = recording({ code: 128, stderr: "fatal: not a git repository\n" })
      const broken = yield* Effect.provide(makeGit(), bad.layer)
      const failure = yield* Effect.flip(broken("/work", ["log"]))
      expect(failure).toBeInstanceOf(GitError)
      expect(failure.code).toBe(128)
      expect(failure.stderr).toBe("fatal: not a git repository")
      expect(failure.message).toBe("git log failed (128): fatal: not a git repository")
    }),
  )
})
