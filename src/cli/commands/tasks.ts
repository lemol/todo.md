import { Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import type { TaskView } from "../../core/index.ts"
import { formatRef, Hub, type TaskRef } from "../../hub/index.ts"
import { type Placement, type TaskPatch, unique } from "../../spec/index.ts"
import {
  author,
  confirm,
  projectOfRefs,
  refOf,
  textOf,
  warnUnpushed,
  withTodo,
  wordsText,
} from "../context.ts"
import { UsageError } from "../errors.ts"
import { label, renderCancellation, renderCompletions, showId } from "../render.ts"

const idArgument = Argument.String("id").pipe(
  Argument.withDescription("The task's ID, e.g. 7 or 07, or <project>:<id> for another project"),
)

/** Words of a variadic argument joined with spaces, so quotes are optional: `todo add Fix the bug --quick`. */
const words = (name: string, description: string) =>
  Argument.String(name).pipe(Argument.variadic({ min: 1 }), Argument.withDescription(description))

const repeated = (name: string, description: string) =>
  Flag.String(name).pipe(Flag.atLeast(0), Flag.withDescription(description))

const optional = (name: string, description: string) =>
  Flag.String(name).pipe(Flag.optional, Flag.withDescription(description))

const some = <A>(key: string, value: Option.Option<A>) =>
  Option.isSome(value) ? { [key]: value.value } : {}

const flagged = (name: string, description: string) =>
  Flag.Boolean(name).pipe(Flag.withDefault(false), Flag.withDescription(description))

/** What `-` does, said the same way wherever text accepts it; `as` shows the form. */
const orStdin = (as: string) =>
  `\`-\` reads it whole from stdin, as in \`${as} <<'EOF'\`, so quotes, backticks and $(…) reach the task verbatim instead of being run by the shell`

export const add = Command.make(
  "add",
  {
    title: words("title", "The task's title"),
    group: optional("group", "Add to this group (created if missing)"),
    noGroup: flagged("no-group", "Add it to the ungrouped tasks"),
    description: optional(
      "description",
      `A longer description (Markdown). ${orStdin("--description -")}`,
    ),
    noDescription: flagged("no-description", "Add it with no description"),
    file: flagged("file", "Give it its own task file (the default)"),
    inline: flagged("inline", "Keep the whole task in TODO.md instead of its own file"),
    quick: flagged(
      "quick",
      "Jot it down: ungrouped, no description, inline. Any of --group, --description, --file overrides that part",
    ),
    tag: repeated("tag", "A tag; repeat for several"),
    assignee: optional("assignee", "Who works on it (a handle)"),
    dependsOn: repeated(
      "depends-on",
      "A task that must be done first; repeat for several (<project>:<id> works too)",
    ),
    before: optional("before", "Place it before this task (same project only)"),
    after: optional("after", "Place it after this task (same project only)"),
  },
  Effect.fn(function* (flags) {
    if (Option.isSome(flags.group) && flags.noGroup) {
      return yield* new UsageError({ message: "use --group or --no-group, not both" })
    }

    if (Option.isSome(flags.description) && flags.noDescription) {
      return yield* new UsageError({ message: "use --description or --no-description, not both" })
    }

    if (flags.file && flags.inline) {
      return yield* new UsageError({ message: "use --file or --inline, not both" })
    }

    // Where it goes and what it is are decisions, not defaults: a task added
    // without either is the mistake this asks about. An anchor already fixes
    // the group, and --quick answers whatever is left.
    const placed =
      Option.isSome(flags.group) ||
      flags.noGroup ||
      Option.isSome(flags.before) ||
      Option.isSome(flags.after)

    if (!placed && !flags.quick) {
      return yield* new UsageError({
        message: "say where it goes: --group <name>, --no-group, --before or --after",
      })
    }

    if (Option.isNone(flags.description) && !flags.noDescription && !flags.quick) {
      return yield* new UsageError({
        message:
          "say what it is: --description <text>, --description - to read stdin, or --no-description",
      })
    }

    const description = Option.isSome(flags.description)
      ? yield* textOf("description", flags.description.value)
      : undefined

    const dependsOn = flags.dependsOn.map(refOf)
    const before = Option.map(flags.before, refOf)
    const after = Option.map(flags.after, refOf)
    // Its own file by default, so a long task does not swamp TODO.md (§2.9).
    const wantsFile = flags.file || !(flags.inline || flags.quick)

    const toStoredId = (projectName: string) => (ref: TaskRef) =>
      ref.project !== undefined && ref.project !== projectName
        ? formatRef(ref.project, ref.id)
        : ref.id

    yield* withTodo((todo, project) =>
      Effect.gen(function* () {
        for (const anchor of [...Option.toArray(before), ...Option.toArray(after)]) {
          if (anchor.project !== undefined && anchor.project !== project.name) {
            return yield* new UsageError({
              message: `anchor project ${anchor.project} contradicts ${project.name}`,
            })
          }
        }

        // A new group is as often a typo or the wrong list as an intention,
        // so say when --group creates one. The listing is unfiltered, since
        // an empty heading already counts as the group.
        const group = Option.getOrUndefined(flags.group)
        const created =
          group !== undefined &&
          !(yield* todo.list()).sections.some((section) => section.name === group)

        const task = yield* todo.add(
          {
            title: flags.title.join(" "),
            ...(flags.tag.length > 0 ? { tags: flags.tag } : {}),
            ...(dependsOn.length > 0 ? { dependsOn: dependsOn.map(toStoredId(project.name)) } : {}),
            ...some("assignee", flags.assignee),
            ...(description === undefined ? {} : { description }),
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

        // A store with nowhere to put a task file keeps the task as it is;
        // an explicit --file says so rather than pretending it worked.
        if (wantsFile && (todo.capabilities.promote || flags.file)) yield* todo.promote(task.id)

        const into =
          task.group === undefined
            ? ""
            : created
              ? ` to new group ${task.group}`
              : ` to ${task.group}`

        yield* confirm(project, task, () => [`Added ${label(task)}${into}`])
        yield* warnUnpushed(project)
      }),
    )
  }),
).pipe(
  Command.withDescription("Add a task, in its own file unless told otherwise"),
  Command.withExamples([
    {
      command: "todo add Write the changelog --quick",
      description: "Jot one down: ungrouped, no description, inline (quotes optional)",
    },
    {
      command: 'todo add "Fix login redirect" --group Backend --no-description --tag bug',
      description: "A tagged task in a group, with its own file",
    },
    {
      command: 'todo add "Expose promotion" --group Core --description - < notes.md',
      description: "Take the description from stdin, so the shell leaves it alone",
    },
    {
      command: "todo add Ship it --no-group --no-description --json",
      description: "Print the new task as JSON",
    },
  ]),
)

export const promote = Command.make(
  "promote",
  { id: idArgument },
  Effect.fn(function* ({ id }) {
    const ref = refOf(id)
    const refProject = yield* projectOfRefs([ref])

    yield* withTodo(
      (todo, project) =>
        Effect.gen(function* () {
          const task = yield* todo.promote(ref.id)

          yield* confirm(project, task, () => [`${label(task)} now has its own file`])
          yield* warnUnpushed(project)
        }),
      { project: refProject },
    )
  }),
).pipe(
  Command.withDescription(
    "Move an inline task into its own file, leaving a link behind; does nothing if it has one",
  ),
  Command.withExamples([
    { command: "todo promote 3", description: "Give task 03 its own file" },
    { command: "todo promote 3 --json", description: "Print the task as JSON" },
  ]),
)

export const edit = Command.make(
  "edit",
  {
    id: idArgument,
    title: optional("title", "A new title"),
    description: optional(
      "description",
      `A new description (Markdown). ${orStdin("--description -")}`,
    ),
    file: flagged("file", "Also move it into its own file, if it is still inline"),
    tag: repeated("tag", "Add a tag; repeat for several"),
    untag: repeated("untag", "Remove a tag; repeat for several"),
    assignee: optional("assignee", "Assign it to this handle"),
    unassign: Flag.Boolean("unassign").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Remove the assignee"),
    ),
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

    const description = Option.isSome(flags.description)
      ? yield* textOf("description", flags.description.value)
      : undefined

    const id = refOf(flags.id)
    const dependsOn = flags.dependsOn.map(refOf)
    const drop = flags.dropDependency.map(refOf)
    const refProject = yield* projectOfRefs([id])

    const toStoredId = (projectName: string) => (ref: TaskRef) =>
      ref.project !== undefined && ref.project !== projectName
        ? formatRef(ref.project, ref.id)
        : ref.id

    yield* withTodo(
      (todo, project) =>
        Effect.gen(function* () {
          const current = (yield* todo.show(id.id)).view.task
          const stored = toStoredId(project.name)
          const dropped = new Set(drop.map(stored))
          const patch: TaskPatch = {
            ...some("title", flags.title),
            ...(description === undefined ? {} : { description }),
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
                    ...dependsOn.map(stored),
                  ]),
                }
              : {}),
          }

          if (Object.keys(patch).length === 0 && !flags.file) {
            return yield* new UsageError({
              message: "nothing to change; pass --title, --tag, --assignee or another change",
            })
          }

          // Promote first, so the change lands as a minimal edit to the new
          // task file instead of rewriting an inline item into a link.
          if (flags.file) yield* todo.promote(id.id)

          const task =
            Object.keys(patch).length === 0
              ? (yield* todo.show(id.id)).view.task
              : yield* todo.update(id.id, patch)

          yield* confirm(project, task, () => [`Updated ${label(task)}`])
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
    {
      command: "todo edit 3 --file --description - < notes.md",
      description: "Move it into its own file and write the body from stdin",
    },
  ]),
)

/** Ready tasks in other registered projects that wait on one of `completed`. */
const newlyReadyInOtherProjects = (
  completed: ReadonlyArray<TaskRef>,
  current: string,
): Effect.Effect<
  ReadonlyArray<{ readonly project: string; readonly view: TaskView }>,
  never,
  Hub
> =>
  Effect.catch(
    Effect.gen(function* () {
      const hub = yield* Hub
      const keys = new Set(completed.map((ref) => formatRef(ref.project ?? current, ref.id)))

      if (keys.size === 0) {
        return [] as ReadonlyArray<{ readonly project: string; readonly view: TaskView }>
      }

      const infos = yield* hub.projects()
      const out: Array<{ readonly project: string; readonly view: TaskView }> = []

      for (const info of infos) {
        if (!info.registered || info.name === current) continue

        const service = yield* Effect.option(hub.todo(info.name))

        if (service._tag === "None") continue

        const ready = yield* Effect.option(service.value.next())

        if (ready._tag === "None") continue

        for (const view of ready.value) {
          if (view.state !== "ready") continue

          if (view.task.dependsOn.some((dep) => keys.has(dep))) {
            out.push({ project: info.name, view })
          }
        }
      }

      return out as ReadonlyArray<{ readonly project: string; readonly view: TaskView }>
    }),
    () =>
      Effect.succeed([] as ReadonlyArray<{ readonly project: string; readonly view: TaskView }>),
  )

export const done = Command.make(
  "done",
  {
    ids: Argument.String("id").pipe(
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
          const cross = yield* newlyReadyInOtherProjects(refs, project.name)

          yield* confirm(project, completions, (style) =>
            renderCompletions(completions, style, cross),
          )
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

export const cancel = Command.make(
  "cancel",
  {
    id: idArgument,
    reason: Flag.String("reason").pipe(
      Flag.withDescription(`Why the task is being abandoned (required). ${orStdin("--reason -")}`),
    ),
  },
  Effect.fn(function* ({ id, reason }) {
    const ref = refOf(id)
    const text = yield* textOf("reason", reason)
    const refProject = yield* projectOfRefs([ref])

    yield* withTodo(
      (todo, project) =>
        Effect.gen(function* () {
          const cancelled = yield* todo.cancel(ref.id, text)

          yield* confirm(project, cancelled, (style) => renderCancellation(cancelled, style))
          yield* warnUnpushed(project)
        }),
      { project: refProject },
    )
  }),
).pipe(
  Command.withDescription(
    "Abandon a task: it moves to done/ recorded as cancelled, with the reason, and satisfies no dependency",
  ),
  Command.withExamples([
    {
      command: 'todo cancel 12 --reason "Superseded: there is no apps/ directory."',
      description: "Cancel task 12, recording why",
    },
    {
      command: "todo cancel 12 --reason - <<'EOF'",
      description: "Take the reason from stdin, so backticks and $(…) reach the task verbatim",
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

          yield* confirm(project, task, () => [`Reopened ${label(task)}`])
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
    ungrouped: Flag.Boolean("ungrouped").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Move to the end of the ungrouped tasks"),
    ),
    before: optional("before", "Move right before this task (same project only)"),
    after: optional("after", "Move right after this task (same project only)"),
    top: Flag.Boolean("top").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Move to the top of its group"),
    ),
    bottom: Flag.Boolean("bottom").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Move to the bottom of its group"),
    ),
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
    const refProject = yield* projectOfRefs([id])

    yield* withTodo(
      (todo, project) =>
        Effect.gen(function* () {
          for (const anchor of [...Option.toArray(before), ...Option.toArray(after)]) {
            if (anchor.project !== undefined && anchor.project !== project.name) {
              return yield* new UsageError({
                message: `anchor project ${anchor.project} contradicts ${project.name}`,
              })
            }
          }

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

          yield* confirm(project, placed, () => [
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
    force: Flag.Boolean("force").pipe(
      Flag.withDefault(false),
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
          yield* confirm(project, { removed: ref.id }, () => [`Removed ${showId(ref.id)}`])
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
    text: words(
      "text",
      `The comment (Markdown; quotes optional). On its own, ${orStdin("todo comment 3 -")}`,
    ),
    author: optional("author", "Who is commenting (default: $TODO_MD_AUTHOR, then your user name)"),
  },
  Effect.fn(function* (flags) {
    const ref = refOf(flags.id)
    const refProject = yield* projectOfRefs([ref])
    const by = yield* author(flags.author)
    const body = yield* wordsText("comment", flags.text)

    yield* withTodo(
      (todo, project) =>
        Effect.gen(function* () {
          const added = yield* todo.comment(ref.id, { author: by, body })

          yield* confirm(project, added, () => [`Commented on ${showId(ref.id)}`])
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
    {
      command: "todo comment 3 - <<'EOF'",
      description: "Take the comment from stdin, so backticks and $(…) reach the task verbatim",
    },
  ]),
)
