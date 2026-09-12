import { Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"
import type { TaskFilter } from "../../core/index.ts"
import { output, taskId, withTodo } from "../context.ts"
import { ProblemsFound, UsageError } from "../errors.ts"
import { renderDetail, renderDiagnostics, renderListing, taskLines } from "../render.ts"

/** Filters shared by `list` and `next`. */
const filterFlags = {
  tag: Flag.string("tag").pipe(
    Flag.atLeast(0),
    Flag.withDescription("Only tasks with this tag; repeat to require several"),
  ),
  assignee: Flag.string("assignee").pipe(
    Flag.optional,
    Flag.withDescription("Only tasks assigned to this handle"),
  ),
  group: Flag.string("group").pipe(Flag.optional, Flag.withDescription("Only tasks in this group")),
}

const filterOf = (flags: {
  readonly tag: ReadonlyArray<string>
  readonly assignee: Option.Option<string>
  readonly group: Option.Option<string>
}): TaskFilter => ({
  ...(flags.tag.length > 0 ? { tags: flags.tag } : {}),
  ...(Option.isSome(flags.assignee) ? { assignee: flags.assignee.value } : {}),
  ...(Option.isSome(flags.group) ? { group: flags.group.value } : {}),
})

/** Prints the list; `todo` with no command does this too. */
export const showList = (filter: TaskFilter = {}) =>
  Effect.gen(function* () {
    const listing = yield* withTodo((todo) => todo.list(filter))
    yield* output(listing, (style) => renderListing(listing, style))
  })

export const list = Command.make(
  "list",
  {
    ...filterFlags,
    ready: Flag.boolean("ready").pipe(Flag.withDescription("Only tasks that are ready")),
    blocked: Flag.boolean("blocked").pipe(
      Flag.withDescription("Only tasks blocked by an unfinished dependency"),
    ),
    done: Flag.boolean("done").pipe(Flag.withDescription("Only done tasks, newest first")),
    all: Flag.boolean("all").pipe(Flag.withDescription("Open and done tasks")),
  },
  Effect.fn(function* (flags) {
    if (flags.ready && flags.blocked) {
      return yield* new UsageError({ message: "use --ready or --blocked, not both" })
    }
    const state = flags.ready ? "ready" : flags.blocked ? "blocked" : undefined
    const status = flags.all ? "all" : flags.done ? "done" : "open"
    yield* showList({ ...filterOf(flags), status, ...(state === undefined ? {} : { state }) })
  }),
).pipe(
  Command.withAlias("ls"),
  Command.withDescription("Show open tasks by group, with what blocks them"),
  Command.withExamples([
    { command: "todo list", description: "Everything open (same as plain `todo`)" },
    { command: "todo ls --tag bug --ready", description: "Ready tasks tagged #bug" },
    { command: "todo list --done", description: "Completed tasks, newest first" },
    { command: "todo list --json", description: "The whole listing as JSON" },
  ]),
)

export const next = Command.make(
  "next",
  {
    ...filterFlags,
    limit: Flag.integer("limit").pipe(
      Flag.withDefault(1),
      Flag.withDescription("How many ready tasks to show (0 for all)"),
    ),
  },
  Effect.fn(function* (flags) {
    const ready = yield* withTodo((todo) => todo.next(filterOf(flags)))
    const shown = flags.limit > 0 ? ready.slice(0, flags.limit) : ready
    yield* output(shown, (style) =>
      shown.length === 0 ? ["Nothing is ready."] : taskLines(shown, style),
    )
  }),
).pipe(
  Command.withDescription("Show the ready task(s) to work on next, in priority order"),
  Command.withExamples([
    { command: "todo next", description: "The single most important ready task" },
    {
      command: "todo next --assignee claude --limit 3 --json",
      description: "An agent's next three",
    },
  ]),
)

export const show = Command.make(
  "show",
  { id: Argument.string("id").pipe(Argument.withDescription("The task's ID, e.g. 7 or 07")) },
  Effect.fn(function* ({ id }) {
    const detail = yield* withTodo((todo) => todo.show(taskId(id)))
    yield* output(detail, (style) => renderDetail(detail, style))
  }),
).pipe(
  Command.withDescription(
    "Show a task: state, description, dependencies, blocked tasks and comments",
  ),
  Command.withExamples([
    { command: "todo show 7", description: "Everything about task 07" },
    { command: "todo show 7 --json", description: "The same, as JSON" },
  ]),
)

export const check = Command.make(
  "check",
  {},
  Effect.fn(function* () {
    const diagnostics = yield* withTodo((todo) => todo.check())
    yield* output(diagnostics, (style) => renderDiagnostics(diagnostics, style))
    const errors = diagnostics.filter((d) => d.severity === "error").length
    if (errors > 0) return yield* new ProblemsFound({ errors })
  }),
).pipe(
  Command.withDescription("Validate the list; exits with 1 when it finds errors"),
  Command.withExamples([
    {
      command: "todo check",
      description: "List problems such as broken links or dependency cycles",
    },
    { command: "todo check --json", description: "The diagnostics as JSON" },
  ]),
)
