import { Effect, Option, Path } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"
import { FsTodoStore, initList, type NormalizeReport } from "../../fs/index.ts"
import { CliContext, Dir, listRoot, output } from "../context.ts"

export const init = Command.make(
  "init",
  {
    dir: Argument.string("dir").pipe(
      Argument.optional,
      Argument.withDescription("Where to create the list (default: ./todo)"),
    ),
    title: Flag.string("title").pipe(
      Flag.optional,
      Flag.withDescription("The list's title (default: the working directory's name)"),
    ),
  },
  Effect.fn(function* ({ dir, title }) {
    const { cwd } = yield* CliContext
    const path = yield* Path.Path
    const fallback = Option.getOrElse(yield* Dir, () => "todo")
    const target = Option.getOrElse(dir, () => fallback)
    const root = path.resolve(cwd, target)
    yield* initList(root, { title: Option.getOrElse(title, () => path.basename(cwd)) })
    yield* output({ root }, () => [`Created ${path.join(path.relative(cwd, root), "TODO.md")}`])
  }),
).pipe(
  Command.withDescription("Create a todo.md list: a directory holding TODO.md"),
  Command.withExamples([
    { command: "todo init", description: "Create ./todo/TODO.md titled after this directory" },
    { command: 'todo init docs/tasks --title "Acme API"', description: "Create a list elsewhere" },
  ]),
)

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

const summarize = (report: NormalizeReport): string => {
  const parts = [
    ...(report.assigned.length > 0 ? [`numbered ${plural(report.assigned.length, "task")}`] : []),
    ...(report.swept.length > 0
      ? [`completed ${plural(report.swept.length, "checked task")}`]
      : []),
    ...(report.finished.length > 0
      ? [`finished ${plural(report.finished.length, "interrupted completion")}`]
      : []),
  ]
  const text = parts.join(", ")
  return text === "" ? "Nothing to normalize." : `${text[0]?.toUpperCase()}${text.slice(1)}.`
}

export const fmt = Command.make(
  "fmt",
  {},
  Effect.fn(function* () {
    const report = yield* FsTodoStore.normalize(yield* listRoot)
    yield* output(report, () => [summarize(report)])
  }),
).pipe(
  Command.withDescription(
    "Normalize a hand-edited list: number new items, complete ticked ones, sync link text",
  ),
  Command.withExamples([
    { command: "todo fmt", description: "Tidy TODO.md after editing it by hand" },
  ]),
)
