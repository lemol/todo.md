import { Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"
import { type Placement, type TaskPatch, unique } from "../../spec/index.ts"
import { author, output, projectOfRefs, refOf, warnUnpushed, withTodo } from "../context.ts"
import { UsageError } from "../errors.ts"
import { label, renderCompletions, showId } from "../render.ts"

const idArgument = Argument.string("id").pipe(
  Argument.withDescription("The task's ID, e.g. 7 or 07, or <project>:<id> for another project"),
)

/** Words of a variadic argument joined with spaces, so quotes are optional: `todo add Fix the bug`. */
const words = (name: string, description: string) =>
  Argument.string(name).pipe(Argument.variadic({ min: 1 }), Argument.withDescription(description))

const repeated = (name: string, description: string) =>
  Flag.string(name).pipe(Flag.atLeast(0), Flag.withDescription(description))

const optional = (name: string, description: string) =>
  Flag.string(name).pipe(Flag.optional, Flag.withDescription(description))

const some = <A>(key: string, value: Option.Option<A>) =>
  Option.isSome(value) ? { [key]: value.value } : {}

export const add = Command.make(
  "add",
  {
    title: words("title", "The task's title"),
    group: optional("group", "Add to this group (created if missing); default: ungrouped"),
    tag: repeated("tag", "A tag; repeat for several"),
    assignee: optional("assignee", "Who works on it (a handle)"),
    dependsOn: repeated(
      "depends-on",
      "A task that must be done first; repeat for several (<project>:<id> works too)",
    ),
    description: optional("description", "A longer description (Markdown)"),
    before: optional("before", "Place it before this task (<project>:<id> works too)"),
    after: optional("after", "Place it after this task (<project>:<id> works too)"),
  },
  Effect.fn(function* (flags) {
    const dependsOn = flags.dependsOn.map(refOf)
    const before = Option.map(flags.before, refOf)
    const after = Option.map(flags.after, refOf)
    const refProject = yield* projectOfRefs([
      ...dependsOn,
      ...Option.toArray(before),
      ...Option.toArray(after),
    ])
    yield* withTodo(
      (todo, project) =>
        Effect.gen(function* () {
          const task = yield* todo.add(
            {
              title: flags.title.join(" "),
              ...(flags.tag.length > 0 ? { tags: flags.tag } : {}),
              ...(dependsOn.length > 0 ? { dependsOn: dependsOn.map((ref) => ref.id) } : {}),
              ...some("assignee", flags.assignee),
              ...some("description", flags.description),
            },
            {
              ...some("group", flags.group),
              ...some(
                "before",
                Option.map(before, (ref) => ref.id),
              ),
              ...some(
                "after",
                Option.map(after, (ref) => ref.id),
              ),
            },
          )
          yield* output(project, task, () => [
            `Added ${label(task)}${task.group === undefined ? "" : ` to ${task.group}`}`,
          ])
          yield* warnUnpushed(project)
        }),
      { project: refProject },
    )
  }),
).pipe(
  Command.withDescription("Add a task"),
  Command.withExamples([
    { command: "todo add Write the changelog", description: "An ungrouped task (quotes optional)" },
    {
      command: 'todo add "Fix login redirect" --group Backend --tag bug --depends-on 2',
      description: "A tagged task in a group, waiting for task 02",
    },
    { command: "todo add Ship it --json", description: "Print the new task as JSON" },
  ]),
)

export const edit = Command.make(
  "edit",
  {
    id: idArgument,
    title: optional("title", "A new title"),
    description: optional("description", "A new description (Markdown)"),
    tag: repeated("tag", "Add a tag; repeat for several"),
    untag: repeated("untag", "Remove a tag; repeat for several"),
    assignee: optional("assignee", "Assign it to this handle"),
    unassign: Flag.boolean("unassign").pipe(Flag.withDescription("Remove the assignee")),
    dependsOn: repeated(
      "depends-on",
      "Add a dependency; repeat for several (<project>:<id> works too)",
    ),
    dropDependency: repeated(
      "drop-dependency",
      "Remove a dependency; repeat for several (<project>:<id> works too)",
    ),
  },
  Effect.fn(function* (flags) {
    if (flags.unassign && Option.isSome(flags.assignee)) {
      return yield* new UsageError({ message: "use --assignee or --unassign, not both" })
    }
    const id = refOf(flags.id)
    const dependsOn = flags.dependsOn.map(refOf)
    const drop = flags.dropDependency.map(refOf)
    const refProject = yield* projectOfRefs([id, ...dependsOn, ...drop])
    yield* withTodo(
      (todo, project) =>
        Effect.gen(function* () {
          const current = (yield* todo.show(id.id)).view.task
          const dropped = new Set(drop.map((ref) => ref.id))
          const patch: TaskPatch = {
            ...some("title", flags.title),
            ...some("description", flags.description),
            ...(flags.tag.length > 0 || flags.untag.length > 0
              ? {
                  tags: unique([
                    ...current.tags.filter((t) => !flags.untag.includes(t)),
                    ...flags.tag,
                  ]),
                }
              : {}),
            ...(flags.unassign ? { assignee: null } : some("assignee", flags.assignee)),
            ...(dependsOn.length > 0 || dropped.size > 0
              ? {
                  dependsOn: unique([
                    ...current.dependsOn.filter((d) => !dropped.has(d)),
                    ...dependsOn.map((ref) => ref.id),
                  ]),
                }
              : {}),
          }
          if (Object.keys(patch).length === 0) {
            return yield* new UsageError({
              message: "nothing to change; pass --title, --tag, --assignee or another change",
            })
          }
          const task = yield* todo.update(id.id, patch)
          yield* output(project, task, () => [`Updated ${label(task)}`])
          yield* warnUnpushed(project)
        }),
      { project: refProject },
    )
  }),
).pipe(
  Command.withDescription("Change a task's title, description, tags, assignee or dependencies"),
  Command.withExamples([
    { command: 'todo edit 3 --title "Fix the login redirect"', description: "Rename task 03" },
    {
      command: "todo edit 3 --tag urgent --untag later --assignee claude",
      description: "Retag and assign it",
    },
    {
      command: "todo edit 3 --depends-on 7 --drop-dependency 2",
      description: "Change what it waits for",
    },
  ]),
)

export const done = Command.make(
  "done",
  {
    ids: Argument.string("id").pipe(
      Argument.variadic({ min: 1 }),
      Argument.withDescription("The tasks to complete (<project>:<id> works too)"),
    ),
  },
  Effect.fn(function* ({ ids }) {
    const refs = ids.map(refOf)
    const refProject = yield* projectOfRefs(refs)
    yield* withTodo(
      (todo, project) =>
        Effect.gen(function* () {
          const completions = yield* Effect.forEach(refs, (ref) => todo.complete(ref.id))
          yield* output(project, completions, (style) => renderCompletions(completions, style))
          yield* warnUnpushed(project)
        }),
      { project: refProject },
    )
  }),
).pipe(
  Command.withDescription(
    "Complete tasks; their files move to done/ and newly ready tasks are listed",
  ),
  Command.withExamples([
    { command: "todo done 2", description: "Complete task 02" },
    {
      command: "todo done 2 3 --json",
      description: "Complete two tasks; print what they unblocked",
    },
  ]),
)

export const reopen = Command.make(
  "reopen",
  { id: idArgument },
  Effect.fn(function* ({ id }) {
    const ref = refOf(id)
    const refProject = yield* projectOfRefs([ref])
    yield* withTodo(
      (todo, project) =>
        Effect.gen(function* () {
          const task = yield* todo.reopen(ref.id)
          yield* output(project, task, () => [`Reopened ${label(task)}`])
          yield* warnUnpushed(project)
        }),
      { project: refProject },
    )
  }),
).pipe(
  Command.withDescription("Reopen a done task at the end of its group"),
  Command.withExamples([{ command: "todo reopen 2", description: "Put task 02 back on the list" }]),
)

export const mv = Command.make(
  "mv",
  {
    id: idArgument,
    group: optional("group", "Move to the end of this group (created if missing)"),
    ungrouped: Flag.boolean("ungrouped").pipe(
      Flag.withDescription("Move to the end of the ungrouped tasks"),
    ),
    before: optional("before", "Move right before this task (<project>:<id> works too)"),
    after: optional("after", "Move right after this task (<project>:<id> works too)"),
    top: Flag.boolean("top").pipe(Flag.withDescription("Move to the top of its group")),
    bottom: Flag.boolean("bottom").pipe(Flag.withDescription("Move to the bottom of its group")),
  },
  Effect.fn(function* (flags) {
    const chosen = [
      Option.isSome(flags.group),
      flags.ungrouped,
      Option.isSome(flags.before),
      Option.isSome(flags.after),
      flags.top,
      flags.bottom,
    ].filter(Boolean).length
    if (chosen !== 1) {
      return yield* new UsageError({
        message:
          "say where to move it with one of --group, --ungrouped, --before, --after, --top, --bottom",
      })
    }
    const id = refOf(flags.id)
    const before = Option.map(flags.before, refOf)
    const after = Option.map(flags.after, refOf)
    const refProject = yield* projectOfRefs([
      id,
      ...Option.toArray(before),
      ...Option.toArray(after),
    ])
    yield* withTodo(
      (todo, project) =>
        Effect.gen(function* () {
          const current = (yield* todo.show(id.id)).view.task
          const placed = yield* Effect.gen(function* () {
            if (flags.top) {
              const listing = yield* todo.list()
              const section = listing.sections.find((s) => s.tasks.some((v) => v.task.id === id.id))
              const first = section?.tasks[0]?.task
              if (first === undefined || first.id === id.id) return current
              return yield* todo.move(id.id, { before: first.id })
            }
            const placement: Placement = flags.bottom
              ? current.group === undefined
                ? {}
                : { group: current.group }
              : {
                  ...some("group", flags.group),
                  ...some(
                    "before",
                    Option.map(before, (ref) => ref.id),
                  ),
                  ...some(
                    "after",
                    Option.map(after, (ref) => ref.id),
                  ),
                }
            return yield* todo.move(id.id, placement)
          })
          yield* output(project, placed, () => [
            `Moved ${label(placed)} to ${placed.group ?? "the ungrouped tasks"}`,
          ])
          yield* warnUnpushed(project)
        }),
      { project: refProject },
    )
  }),
).pipe(
  Command.withDescription("Reorder a task or move it to another group"),
  Command.withExamples([
    { command: "todo mv 3 --top", description: "Make task 03 the first of its group" },
    { command: "todo mv 3 --before 7", description: "Put it right before task 07" },
    { command: "todo mv 3 --group Frontend", description: "Move it to the end of Frontend" },
  ]),
)

export const rm = Command.make(
  "rm",
  {
    id: idArgument,
    force: Flag.boolean("force").pipe(
      Flag.withDescription("Remove it even if open tasks depend on it"),
    ),
  },
  Effect.fn(function* ({ id, force }) {
    const ref = refOf(id)
    const refProject = yield* projectOfRefs([ref])
    yield* withTodo(
      (todo, project) =>
        Effect.gen(function* () {
          yield* todo.remove(ref.id, { force })
          yield* output(project, { removed: ref.id }, () => [`Removed ${showId(ref.id)}`])
          yield* warnUnpushed(project)
        }),
      { project: refProject },
    )
  }),
).pipe(
  Command.withDescription(
    "Delete a task and its file for good (version control keeps the history)",
  ),
  Command.withExamples([
    { command: "todo rm 3", description: "Delete task 03" },
    { command: "todo rm 3 --force", description: "Delete it even though other tasks depend on it" },
  ]),
)

export const comment = Command.make(
  "comment",
  {
    id: idArgument,
    text: words("text", "The comment (Markdown; quotes optional)"),
    author: optional("author", "Who is commenting (default: $TODO_MD_AUTHOR, then your user name)"),
  },
  Effect.fn(function* (flags) {
    const ref = refOf(flags.id)
    const refProject = yield* projectOfRefs([ref])
    const by = yield* author(flags.author)
    yield* withTodo(
      (todo, project) =>
        Effect.gen(function* () {
          const added = yield* todo.comment(ref.id, { author: by, body: flags.text.join(" ") })
          yield* output(project, added, () => [`Commented on ${showId(ref.id)}`])
          yield* warnUnpushed(project)
        }),
      { project: refProject },
    )
  }),
).pipe(
  Command.withDescription("Add a comment to a task (it moves into its own file if it was inline)"),
  Command.withExamples([
    {
      command: 'todo comment 3 "Found the cause: the referrer is dropped."',
      description: "Comment as yourself",
    },
    { command: "todo comment 3 Started --author claude", description: "Comment as an agent" },
  ]),
)
