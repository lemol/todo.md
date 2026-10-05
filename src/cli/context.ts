import { Console, Context, Effect, Option } from "effect"
import { Flag, GlobalFlag } from "effect/cli"
import type { TodoService } from "../core/index.ts"
import { type AnySource, Hub, type ProjectInfo, parseRef, type TaskRef } from "../hub/index.ts"
import { UsageError } from "./errors.ts"
import { type Style, styleFor } from "./style.ts"

/** Where the CLI runs. `bin.ts` fills it from the process; tests pass their own. */
export class CliContext extends Context.Service<
  CliContext,
  {
    readonly cwd: string
    readonly env: Readonly<Record<string, string | undefined>>
    /** The OS user name: the last fallback for a comment's author. */
    readonly username: string
    /** Whether to color human output. */
    readonly color: boolean
    /** The hub's directory: `$TODO_MD_HOME`, else `<userHome>/.todo-md`. */
    readonly home: string
    /** The OS home directory: `~` in registry paths expands to it. */
    readonly userHome: string
    /** The sources the hub can open. Production passes `[fsSource]`; tests add more. */
    readonly sources: ReadonlyArray<AnySource>
    /**
     * This process's stdin, read whole when a text flag is given `-`.
     * `bin.ts` passes a deferred read, so commands that never ask for `-`
     * never touch stdin — an eager pre-read would block on a pipe that stays
     * open. Long text arrives this way so the shell never sees it: inside
     * double quotes the shell runs each backticked span as a command
     * substitution before the CLI is reached. Tests pass their own.
     */
    readonly stdin: Effect.Effect<string>
  }
>()("@lemol/todo-md/cli/CliContext") {}

/**
 * Stdin read whole (above), kept raw: leading and trailing whitespace and
 * newlines included. A `-` that piped nothing says so instead of quietly
 * writing an empty text; `refusal` comes from the caller because only it
 * knows how the text was asked for, and `empty` because what counts as
 * nothing depends on what the text becomes.
 */
const stdinText = (refusal: string, empty: (text: string) => boolean = (text) => text === "") =>
  Effect.flatMap(CliContext, (context) =>
    Effect.flatMap(context.stdin, (text) =>
      empty(text) ? new UsageError({ message: refusal }) : Effect.succeed(text),
    ),
  )

/** A text flag's value, where `-` reads it whole from stdin (above). */
export const textOf = (flag: string, value: string) =>
  value === "-"
    ? stdinText(`--${flag} - got nothing on stdin; pipe the text in, or use --no-${flag} for none`)
    : Effect.succeed(value)

/**
 * A variadic text argument's value: words joined with spaces, so quotes stay
 * optional, except that a lone `-` reads the text whole from stdin (above).
 * A dash among other words is just a dash, so only text that is nothing but
 * `-` loses its literal reading — and that text is not worth a comment.
 *
 * The surrounding whitespace goes, since a comment body is trimmed (§1.1)
 * and a heredoc always ends in a newline; everything between stays verbatim,
 * which is what the shell would have eaten. Whitespace alone counts as
 * nothing piped in rather than an empty comment.
 */
export const wordsText = (name: string, parts: ReadonlyArray<string>) =>
  parts.length === 1 && parts[0] === "-"
    ? Effect.map(
        stdinText(`${name} - got nothing on stdin; pipe the text in`, (text) => text.trim() === ""),
        (text) => text.trim(),
      )
    : Effect.succeed(parts.join(" ").trim())

export const Json = GlobalFlag.Setting("json")({
  flag: Flag.Boolean("json").pipe(
    Flag.withDefault(false),
    Flag.withDescription("Print the result as JSON on stdout; failures go to stderr as JSON"),
  ),
})

export const Dir = GlobalFlag.Setting("dir")({
  flag: Flag.String("dir").pipe(
    Flag.optional,
    Flag.withDescription(
      "The list's directory (the one holding TODO.md). Default: the nearest todo/TODO.md or TODO.md above the working directory",
    ),
  ),
})

export const Project = GlobalFlag.Setting("project")({
  flag: Flag.String("project").pipe(
    Flag.optional,
    Flag.withDescription(
      "The project to work on (a name in the registry). Cannot be used with --dir",
    ),
  ),
})

/** A task ID as the store knows it: people may type `07` for task `7`. */
export const taskId = (text: string): string =>
  /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, "") : text

/**
 * Runs `f` with the current project's `TodoService` and its `ProjectInfo`:
 * `--project` by name, else `--dir` as an unregistered list, else the list
 * discovered from the working directory (a registered project when one owns
 * it). `--project` with `--dir` is a usage error.
 */
export const withTodo = <A, E, R>(
  f: (todo: TodoService["Service"], project: ProjectInfo) => Effect.Effect<A, E, R>,
  options?: { readonly project?: string | undefined },
) =>
  Effect.gen(function* () {
    const { cwd } = yield* CliContext
    const dir = yield* Dir
    const flag = yield* Project
    const selected = options?.project ?? (Option.isSome(flag) ? flag.value : undefined)

    if (Option.isSome(dir) && selected !== undefined) {
      return yield* new UsageError({ message: "use --project or --dir, not both" })
    }

    if (Option.isSome(flag) && options?.project !== undefined && options.project !== flag.value) {
      return yield* new UsageError({
        message: `task project ${options.project} contradicts --project ${flag.value}`,
      })
    }

    const hub = yield* Hub
    const info = yield* hub.resolve({
      ...(selected !== undefined ? { project: selected } : {}),
      ...(Option.isSome(dir) ? { dir: dir.value } : {}),
      cwd,
    })

    return yield* f(yield* hub.todo(info.name), info)
  })

/**
 * Splits `project:id` (or a bare ID) into the hub's `TaskRef`; the ID part
 * keeps `taskId`'s leading-zero stripping.
 */
export const refOf = (text: string): TaskRef => {
  const parsed = parseRef(text)

  return { ...parsed, id: taskId(parsed.id) }
}

/**
 * The project one command's refs agree on, if any. Refs naming different
 * projects are a usage error: one command works on one project.
 */
export const projectOfRefs = (
  refs: ReadonlyArray<TaskRef>,
): Effect.Effect<string | undefined, UsageError> =>
  Effect.gen(function* () {
    let project: string | undefined

    for (const ref of refs) {
      if (ref.project === undefined) continue

      if (project !== undefined && project !== ref.project) {
        return yield* new UsageError({
          message: `tasks from several projects (${project}, ${ref.project}); one command works on one project`,
        })
      }

      project = ref.project
    }

    return project
  })

/**
 * Warns on stderr when a mutation landed on a project that is not pushed
 * (`ahead`) or has diverged. Non-syncable projects stay quiet, the exit code
 * stays 0, and a status that cannot be read is ignored.
 */
export const warnUnpushed = (info: ProjectInfo) =>
  Effect.gen(function* () {
    if (!info.syncable) return

    const hub = yield* Hub
    const status = yield* hub.status(info.name).pipe(Effect.orElseSucceed(() => undefined))

    if (status === undefined) return

    if (status.diverged === true) {
      return yield* Console.error(`todo: ${info.name} has diverged; resolve it in ${info.location}`)
    }

    if (status.ahead !== undefined && status.ahead > 0) {
      const last = status.error === undefined ? "" : `: ${status.error}`

      return yield* Console.error(`todo: not pushed (ahead ${status.ahead})${last}`)
    }
  })

/**
 * Prints a result: JSON under `--json`, the human lines otherwise. Object
 * results from a registered project gain its name as `project`; results from
 * unregistered lists keep their shape exactly, and arrays keep theirs
 * (callers needing it there say so in their own structure).
 */
export const output = (
  project: ProjectInfo | undefined,
  value: unknown,
  human: (style: Style) => ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    if (yield* Json) {
      const body =
        project?.registered === true &&
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
          ? { ...value, project: project.name }
          : value

      return yield* Console.log(JSON.stringify(body))
    }

    const { color } = yield* CliContext
    yield* Console.log(human(styleFor(color)).join("\n"))
  })

/** A comment's author: `--author`, else `$TODO_MD_AUTHOR`, else the OS user name. */
export const author = (flag: Option.Option<string>) =>
  Effect.map(CliContext, (context) =>
    Option.getOrElse(flag, () => context.env.TODO_MD_AUTHOR ?? context.username),
  )
