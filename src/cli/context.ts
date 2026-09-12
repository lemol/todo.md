import { Console, Context, Effect, Option, Path } from "effect"
import { Flag, GlobalFlag } from "effect/unstable/cli"
import { TodoService } from "../core/index.ts"
import { FsTodoStore, findListRoot } from "../fs/index.ts"
import { NoListFound } from "./errors.ts"
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
  }
>()("@lemol/todo-md/cli/CliContext") {}

export const Json = GlobalFlag.setting("json")({
  flag: Flag.boolean("json").pipe(
    Flag.withDescription("Print the result as JSON on stdout; failures go to stderr as JSON"),
  ),
})

export const Dir = GlobalFlag.setting("dir")({
  flag: Flag.string("dir").pipe(
    Flag.optional,
    Flag.withDescription(
      "The list's directory (the one holding TODO.md). Default: the nearest todo/TODO.md or TODO.md above the working directory",
    ),
  ),
})

/** A task ID as the store knows it: people may type `07` for task `7`. */
export const taskId = (text: string): string =>
  /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, "") : text

/** The list root: `--dir`, else discovered from the working directory. */
export const listRoot = Effect.gen(function* () {
  const { cwd } = yield* CliContext
  const dir = yield* Dir
  const path = yield* Path.Path
  if (Option.isSome(dir)) return path.resolve(cwd, dir.value)
  const found = yield* findListRoot(cwd)
  if (Option.isNone(found)) return yield* new NoListFound({ cwd })
  return found.value
})

/** Runs `f` with a `TodoService` over the list's files. */
export const withTodo = <A, E>(f: (todo: TodoService["Service"]) => Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const root = yield* listRoot
    return yield* Effect.gen(function* () {
      return yield* f(yield* TodoService)
    }).pipe(Effect.provide(TodoService.layer), Effect.provide(FsTodoStore.layer({ root })))
  })

/** Prints a result: JSON under `--json`, the human lines otherwise. */
export const output = (value: unknown, human: (style: Style) => ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (yield* Json) return yield* Console.log(JSON.stringify(value))
    const { color } = yield* CliContext
    yield* Console.log(human(styleFor(color)).join("\n"))
  })

/** A comment's author: `--author`, else `$TODO_MD_AUTHOR`, else the OS user name. */
export const author = (flag: Option.Option<string>) =>
  Effect.map(CliContext, (context) =>
    Option.getOrElse(flag, () => context.env.TODO_MD_AUTHOR ?? context.username),
  )
