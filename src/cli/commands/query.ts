import { Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"
import type { TaskFilter } from "../../core/index.ts"
import { Hub } from "../../hub/index.ts"
import { output, projectOfRefs, refOf, withTodo } from "../context.ts"
import { ProblemsFound, UsageError } from "../errors.ts"
import {
  renderDetail,
  renderDiagnostics,
  renderListing,
  renderNextOverview,
  renderOverview,
  taskLines,
} from "../render.ts"

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

/** The registered project names, in registry order. */
const registeredNames = Effect.gen(function* () {
  const hub = yield* Hub
  return (yield* hub.projects()).filter((p) => p.registered).map((p) => p.name)
})

/**
 * `ls --all`: every registered project's listing under its own heading. With
 * no registered projects, the current list, open and done, exactly as before.
 */
const showAll = (filter: TaskFilter, done: boolean) =>
  Effect.gen(function* () {
    const names = yield* registeredNames
    if (names.length === 0) return yield* showList({ ...filter, status: "all" })
    const hub = yield* Hub
    const view = yield* hub.overview({
      projects: names,
      filter: { ...filter, status: done ? "done" : "open" },
    })
    yield* output(undefined, view, (style) => renderOverview(view, style))
  })

/**
 * `next --all`: the ready tasks of every registered project. With no
 * registered projects, every ready task of the current list.
 */
const showNextAll = (filter: TaskFilter, limit: number) =>
  Effect.gen(function* () {
    const names = yield* registeredNames
    if (names.length === 0) {
      return yield* withTodo((todo, project) =>
        Effect.gen(function* () {
          const ready = yield* todo.next({ ...filter, state: "ready" })
          yield* output(project, ready, (style) =>
            ready.length === 0 ? ["Nothing is ready."] : taskLines(ready, style),
          )
        }),
      )
    }
    const hub = yield* Hub
    const view = yield* hub.overview({ projects: names, filter: { ...filter, state: "ready" } })
    const shown = limit > 0 ? view.tasks.slice(0, limit) : view.tasks
    yield* output(undefined, view, (style) =>
      shown.length === 0 && !view.projects.some((entry) => "error" in entry)
        ? ["Nothing is ready."]
        : renderNextOverview(view, shown, style),
    )
  })

/** Prints the list; `todo` with no command does this too. */
export const showList = (filter: TaskFilter = {}) =>
  withTodo((todo, project) =>
    Effect.gen(function* () {
      const listing = yield* todo.list(filter)
      yield* output(project, listing, (style) => renderListing(listing, style))
    }),
  )

export const list = Command.make(
  "list",
  {
    ...filterFlags,
    ready: Flag.boolean("ready").pipe(Flag.withDescription("Only tasks that are ready")),
    blocked: Flag.boolean("blocked").pipe(
      Flag.withDescription("Only tasks blocked by an unfinished dependency"),
    ),
    done: Flag.boolean("done").pipe(Flag.withDescription("Only done tasks, newest first")),
    all: Flag.boolean("all").pipe(
      Flag.withDescription("Open and done tasks, or every registered project when any exist"),
    ),
  },
  Effect.fn(function* (flags) {
    if (flags.ready && flags.blocked) {
      return yield* new UsageError({ message: "use --ready or --blocked, not both" })
    }
    const state = flags.ready ? "ready" : flags.blocked ? "blocked" : undefined
    if (!flags.all) {
      const status = flags.done ? "done" : "open"
      yield* showList({ ...filterOf(flags), status, ...(state === undefined ? {} : { state }) })
    } else {
      yield* showAll({ ...filterOf(flags), ...(state === undefined ? {} : { state }) }, flags.done)
    }
  }),
).pipe(
  Command.withAlias("ls"),
  Command.withDescription("Show open tasks by group, with what blocks them"),
  Command.withExamples([
    { command: "todo list", description: "Everything open (same as plain `todo`)" },
    { command: "todo ls --tag bug --ready", description: "Ready tasks tagged #bug" },
    { command: "todo list --done", description: "Completed tasks, newest first" },
    { command: "todo list --json", description: "The whole listing as JSON" },
    { command: "todo ls --all", description: "Every registered project, each under its heading" },
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
    all: Flag.boolean("all").pipe(
      Flag.withDescription(
        "Every registered project (or every ready task when none are registered)",
      ),
    ),
  },
  Effect.fn(function* (flags) {
    if (!flags.all) {
      yield* withTodo((todo, project) =>
        Effect.gen(function* () {
          const ready = yield* todo.next(filterOf(flags))
          const shown = flags.limit > 0 ? ready.slice(0, flags.limit) : ready
          yield* output(project, shown, (style) =>
            shown.length === 0 ? ["Nothing is ready."] : taskLines(shown, style),
          )
        }),
      )
    } else {
      yield* showNextAll(filterOf(flags), flags.limit)
    }
  }),
).pipe(
  Command.withDescription("Show the ready task(s) to work on next, in priority order"),
  Command.withExamples([
    { command: "todo next", description: "The single most important ready task" },
    {
      command: "todo next --assignee claude --limit 3 --json",
      description: "An agent's next three",
    },
    { command: "todo next --all", description: "Ready tasks across every project" },
  ]),
)

export const show = Command.make(
  "show",
  {
    id: Argument.string("id").pipe(
      Argument.withDescription(
        "The task's ID, e.g. 7 or 07, or <project>:<id> for another project",
      ),
    ),
  },
  Effect.fn(function* ({ id }) {
    const ref = refOf(id)
    const refProject = yield* projectOfRefs([ref])
    yield* withTodo(
      (todo, project) =>
        Effect.gen(function* () {
          const detail = yield* todo.show(ref.id)
          yield* output(project, detail, (style) => renderDetail(detail, style))
        }),
      { project: refProject },
    )
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
    yield* withTodo((todo, project) =>
      Effect.gen(function* () {
        const diagnostics = yield* todo.check()
        yield* output(project, diagnostics, (style) => renderDiagnostics(diagnostics, style))
        const errors = diagnostics.filter((d) => d.severity === "error").length
        if (errors > 0) return yield* new ProblemsFound({ errors })
      }),
    )
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
