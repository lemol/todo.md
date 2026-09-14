import { Console, Effect } from "effect"
import { CliOutput, Command } from "effect/unstable/cli"
import { Hub } from "../hub/index.ts"
import { fmt, init } from "./commands/lists.ts"
import { projects, sync } from "./commands/projects.ts"
import { check, list, next, show, showList } from "./commands/query.ts"
import { add, comment, done, edit, mv, reopen, rm } from "./commands/tasks.ts"
import { web } from "./commands/web.ts"
import { CliContext, Dir, Json, Project } from "./context.ts"
import { describeError, errorJson, exitCodeOf } from "./errors.ts"

/** Keep in step with package.json's version. */
export const version = "0.1.0"

export const todo = Command.make("todo", {}, () => showList()).pipe(
  Command.withDescription("Manage a todo.md task list: plain Markdown for humans and agents"),
  Command.withExamples([
    { command: "todo", description: "Show the open tasks (same as `todo list`)" },
    { command: "todo add Fix the login redirect --group Backend", description: "Add a task" },
    { command: "todo next --json", description: "What to work on next, as JSON" },
    { command: "todo done 3", description: "Complete task 03" },
    { command: "todo <command> --help", description: "Help for any command" },
  ]),
  Command.withSubcommands([
    list,
    next,
    show,
    add,
    edit,
    done,
    reopen,
    mv,
    rm,
    comment,
    check,
    init,
    fmt,
    projects,
    sync,
    web,
  ]),
  Command.withGlobalFlags([Json, Dir, Project]),
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
        const tag =
          error && typeof error === "object" && "_tag" in error
            ? String((error as { _tag: unknown })._tag)
            : undefined
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
    Effect.provide(
      Hub.layer({ home: context.home, userHome: context.userHome, sources: context.sources }),
    ),
    Effect.provide(CliOutput.layer(CliOutput.defaultFormatter({ colors: context.color }))),
  )
