import { Console, Effect } from "effect"
import { CliOutput, Command } from "effect/unstable/cli"
import { fmt, init } from "./commands/lists.ts"
import { CliContext, Dir, Json } from "./context.ts"
import { describeError, errorJson, exitCodeOf } from "./errors.ts"

/** Keep in step with package.json's version. */
export const version = "0.0.0"

export const todo = Command.make("todo").pipe(
  Command.withDescription("Manage a todo.md task list: plain Markdown for humans and agents"),
  Command.withSubcommands([init, fmt]),
  Command.withGlobalFlags([Json, Dir]),
)

/**
 * Runs the CLI on `args` and returns the exit code: 0 on success, 1 when an
 * operation fails (the reason is printed on stderr), 2 for a usage error.
 */
export const main = (
  args: ReadonlyArray<string>,
  context: CliContext["Service"],
): Effect.Effect<number, never, Command.Environment> =>
  Command.runWith(todo, { version })(args).pipe(
    Effect.as(0),
    Effect.catch((error) =>
      Effect.gen(function* () {
        // Usage errors were printed with the help; check already printed its problems.
        const tag: string = error._tag
        if (tag !== "ShowHelp" && tag !== "ProblemsFound") {
          yield* Console.error(
            args.includes("--json")
              ? JSON.stringify({ error: errorJson(error) })
              : `error: ${describeError(error)}`,
          )
        }
        return exitCodeOf(error)
      }),
    ),
    Effect.provideService(CliContext, context),
    Effect.provide(CliOutput.layer(CliOutput.defaultFormatter({ colors: context.color }))),
  )
