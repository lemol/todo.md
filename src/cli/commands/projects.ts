import { DateTime, Effect, FileSystem, Option, Path } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { FsTodoStore } from "../../fs/index.ts"
import {
  Hub,
  listRootOf,
  type ProjectInfo,
  projectInput,
  type SyncFailure,
  type SyncResult,
} from "../../hub/index.ts"
import { TodoStore } from "../../spec/index.ts"
import { importList, type Snapshot, SqliteSource } from "../../sqlite/index.ts"
import * as BunSqliteDriver from "../BunSqliteDriver.ts"
import { CliContext, Dir, output, Project } from "../context.ts"
import { SyncFailed, UsageError } from "../errors.ts"
import { projectLine, statusText, syncLine } from "../render.ts"

/** Open and ready counts from the project's unfiltered listing; zeros when it has none. */
const countsOf = (hub: Hub["Service"], name: string) =>
  Effect.gen(function* () {
    const view = yield* hub.overview({ projects: [name] })
    const entry = view.projects.find((candidate) => candidate.project.name === name)

    if (entry === undefined || !("listing" in entry)) return { open: 0, ready: 0 }

    const open = entry.listing.sections.flatMap((section) => section.tasks)

    return { open: open.length, ready: open.filter((item) => item.state === "ready").length }
  })

/** Prints one project line: the `ProjectInfo` as JSON, the line for people. */
const printProject = (hub: Hub["Service"], info: ProjectInfo) =>
  Effect.gen(function* () {
    const counts = yield* countsOf(hub, info.name)
    const status = yield* hub.status(info.name)
    const now = yield* DateTime.now

    yield* output(undefined, info, () => [
      projectLine({ info, ...counts, status: statusText(status, now) }),
    ])
  })

const listProjects = Effect.gen(function* () {
  const { cwd } = yield* CliContext
  const dir = yield* Dir
  const flag = yield* Project

  if (Option.isSome(dir) && Option.isSome(flag)) {
    return yield* new UsageError({ message: "use --project or --dir, not both" })
  }

  const hub = yield* Hub
  const infos = yield* hub.projects()
  const here = yield* hub
    .resolve({
      ...(Option.isSome(flag) ? { project: flag.value } : {}),
      ...(Option.isSome(dir) ? { dir: dir.value } : {}),
      cwd,
    })
    .pipe(
      Effect.map((info) => Option.some(info)),
      Effect.catchTag("NoListFound", () => Effect.succeed(Option.none())),
    )

  const current = Option.getOrUndefined(here)
  const shown =
    current !== undefined &&
    !current.registered &&
    !infos.some((info) => info.name === current.name)
      ? [...infos, current]
      : infos

  const now = yield* DateTime.now
  const lines = yield* Effect.forEach(shown, (info) =>
    Effect.gen(function* () {
      const counts = yield* countsOf(hub, info.name)
      const status = yield* hub.status(info.name)

      return projectLine({ info, ...counts, status: statusText(status, now) })
    }),
  )

  yield* output(undefined, shown, () =>
    lines.length === 0
      ? ["No projects registered. Add one with `todo projects add <dir>`."]
      : lines,
  )
})

export const projectsLs = Command.make("ls", {}, () => listProjects).pipe(
  Command.withDescription("List every registered project with its sync status"),
  Command.withExamples([
    { command: "todo projects", description: "Every project with its sync status" },
    { command: "todo projects ls", description: "The same list" },
  ]),
)

export const projectsAdd = Command.make(
  "add",
  {
    target: Argument.String("target").pipe(
      Argument.withDescription(
        "A directory path for a local list, a git URL, a Jira site, or a SQLite project's name",
      ),
    ),
    name: Flag.String("name").pipe(
      Flag.optional,
      Flag.withDescription("The project's name (default: from the target; required for jira)"),
    ),
    source: Flag.String("source").pipe(
      Flag.optional,
      Flag.withDescription(
        "The source kind: fs, git, jira or sqlite (default: inferred from the target)",
      ),
    ),
    path: Flag.String("path").pipe(
      Flag.optional,
      Flag.withDescription(
        "sqlite only: the database file (default: todo.db in the project's data directory)",
      ),
    ),
    from: Flag.String("from").pipe(
      Flag.optional,
      Flag.withDescription(
        "sqlite only: a Markdown list to copy into the new database, with its IDs, groups, comments and done tasks",
      ),
    ),
    branch: Flag.String("branch").pipe(
      Flag.optional,
      Flag.withDescription("git only: the branch to track (default: the repository's own)"),
    ),
    list: Flag.String("list").pipe(
      Flag.optional,
      Flag.withDescription(
        "git only: the list directory in the repository (default: todo/ or its root)",
      ),
    ),
    email: Flag.String("email").pipe(
      Flag.optional,
      Flag.withDescription("jira only: the account the API token belongs to"),
    ),
    tokenEnv: Flag.String("token-env").pipe(
      Flag.optional,
      Flag.withDescription("jira only: the environment variable holding the API token"),
    ),
    tokenCommand: Flag.String("token-command").pipe(
      Flag.optional,
      Flag.withDescription("jira only: a command printing the API token, e.g. from a keychain"),
    ),
    jql: Flag.String("jql").pipe(
      Flag.optional,
      Flag.withDescription(
        "jira only: the query behind the project (default: assigned to me and not done)",
      ),
    ),
    readOnly: Flag.Boolean("read-only").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "jira only: never write to Jira; sync and read only, and done, reopen, edit and comment fail",
      ),
    ),
  },
  Effect.fn(function* ({
    target,
    name,
    source,
    path,
    from,
    branch,
    list,
    email,
    tokenEnv,
    tokenCommand,
    jql,
    readOnly,
  }) {
    const { cwd, home, userHome } = yield* CliContext
    const paths = yield* Path.Path
    const fs = yield* FileSystem.FileSystem
    const hub = yield* Hub
    const input = yield* projectInput(target, {
      cwd,
      ...(Option.isSome(source) ? { source: source.value } : {}),
      ...(Option.isSome(name) ? { name: name.value } : {}),
      ...(Option.isSome(path) ? { path: path.value } : {}),
      ...(Option.isSome(branch) ? { branch: branch.value } : {}),
      ...(Option.isSome(list) ? { list: list.value } : {}),
      ...(Option.isSome(email) ? { email: email.value } : {}),
      ...(Option.isSome(tokenEnv) ? { tokenEnv: tokenEnv.value } : {}),
      ...(Option.isSome(tokenCommand) ? { tokenCommand: tokenCommand.value } : {}),
      ...(Option.isSome(jql) ? { jql: jql.value } : {}),
      ...(readOnly ? { readOnly } : {}),
    })

    const wrongFor = (
      kind: string,
      given: ReadonlyArray<readonly [string, Option.Option<string>]>,
    ) =>
      input.source === kind
        ? []
        : given.filter(([, value]) => Option.isSome(value)).map(([flag]) => flag)

    const misplaced = [
      ...wrongFor("sqlite", [
        ["--path", path],
        ["--from", from],
      ]),
      ...wrongFor("git", [
        ["--branch", branch],
        ["--list", list],
      ]),
      ...wrongFor("jira", [
        ["--email", email],
        ["--token-env", tokenEnv],
        ["--token-command", tokenCommand],
        ["--jql", jql],
        ["--read-only", readOnly ? Option.some("") : Option.none()],
      ]),
    ]

    if (misplaced.length > 0) {
      return yield* new UsageError({
        message: `${misplaced.join(" and ")} ${misplaced.length === 1 ? "is" : "are"} not for ${input.source} projects; ${target} is a ${input.source} project`,
      })
    }

    const absolute = (dir: string) =>
      dir === "~" || dir.startsWith("~/") ? `${userHome}${dir.slice(1)}` : paths.resolve(cwd, dir)

    let snapshot: Snapshot | undefined = undefined

    if (Option.isSome(from)) {
      const fromDir = absolute(from.value)
      const rootOpt = yield* listRootOf(fromDir)

      if (Option.isNone(rootOpt)) {
        return yield* new UsageError({
          message: `--from ${from.value} has no todo.md list`,
        })
      }

      const root = rootOpt.value

      snapshot = yield* Effect.gen(function* () {
        const store = yield* TodoStore
        const diagnostics = yield* store.diagnostics()
        const errors = diagnostics.filter((d) => d.severity === "error").length

        if (errors > 0) {
          return yield* new UsageError({
            message: `--from ${from.value} has ${errors} error${errors === 1 ? "" : "s"}; fix them first (todo check --dir ${root})`,
          })
        }

        const list = yield* store.load()
        const done = yield* store.listDone()

        return { list, done }
      }).pipe(Effect.provide(FsTodoStore.layer({ root })))
    }

    const info = yield* hub.add(input)

    if (snapshot !== undefined) {
      const file = Option.isSome(path)
        ? absolute(path.value)
        : paths.join(home, "projects", info.name, SqliteSource.defaultFile)

      yield* fs.makeDirectory(paths.dirname(file), { recursive: true }).pipe(
        Effect.mapError((error) => new UsageError({ message: error.message })),
        Effect.andThen(importList({ path: file, title: info.name }, snapshot)),
        Effect.provide(BunSqliteDriver.layer),
        Effect.onError(() => Effect.ignore(hub.remove(info.name, { force: true }))),
      )
    }

    yield* printProject(hub, info)
  }),
).pipe(
  Command.withDescription(
    "Register a directory, a git URL, a Jira site or a SQLite list as a project",
  ),
  Command.withExamples([
    { command: "todo projects add ~/labs/acme", description: "Register a local list" },
    {
      command: "todo projects add ~/labs/acme --name acme",
      description: "Register it under another name",
    },
    {
      command: "todo projects add groceries --source sqlite",
      description: "Keep a list in a SQLite file the hub manages",
    },
    {
      command: "todo projects add groceries --source sqlite --path ~/notes/groceries.db",
      description: "Keep it in a file of your own; removing the project leaves the file",
    },
    {
      command: "todo projects add groceries --source sqlite --from ~/notes/groceries",
      description: "Start it with the tasks of a Markdown list, IDs and all",
    },
    {
      command: "todo projects add git@example.com:acme/app.git",
      description: "Clone a git repository and follow its list",
    },
    {
      command: "todo projects add https://example.com/acme/app.git --branch main --list docs/todo",
      description: "Follow one branch and one directory of it",
    },
    {
      command:
        "todo projects add https://acme.atlassian.net --source jira --name work --email me@acme.test --token-env JIRA_TOKEN",
      description: "Follow the Jira issues assigned to you",
    },
    {
      command:
        "todo projects add https://acme.atlassian.net --source jira --name proj --email me@acme.test --token-command 'security find-generic-password -s jira -w' --jql 'project = PROJ AND statusCategory != Done'",
      description: "Take the token from the macOS keychain and follow one project",
    },
    {
      command:
        "todo projects add https://acme.atlassian.net --source jira --name work --email me@acme.test --token-env JIRA_TOKEN --read-only",
      description: "Mirror a site without ever changing a ticket in it",
    },
  ]),
)

export const projectsRm = Command.make(
  "rm",
  {
    name: Argument.String("name").pipe(Argument.withDescription("The project to remove")),
    force: Flag.Boolean("force").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Remove it even if the source refuses (e.g. unpushed commits)"),
    ),
  },
  Effect.fn(function* ({ name, force }) {
    const hub = yield* Hub

    yield* hub.remove(name, { force })
    yield* output(undefined, { removed: name }, () => [`Removed project ${name}`])
  }),
).pipe(
  Command.withDescription("Remove a project from the registry (its list files stay)"),
  Command.withExamples([
    { command: "todo projects rm old", description: "Forget the project old" },
    { command: "todo projects rm old --force", description: "Forget it despite its warnings" },
  ]),
)

export const projectsRename = Command.make(
  "rename",
  {
    from: Argument.String("from").pipe(Argument.withDescription("The project's current name")),
    to: Argument.String("to").pipe(Argument.withDescription("The project's new name")),
  },
  Effect.fn(function* ({ from, to }) {
    const hub = yield* Hub

    yield* printProject(hub, yield* hub.rename(from, to))
  }),
).pipe(
  Command.withDescription("Rename a registered project"),
  Command.withExamples([
    { command: "todo projects rename old new", description: "Call the project old new" },
  ]),
)

export const sync = Command.make(
  "sync",
  {
    names: Argument.String("name").pipe(
      Argument.variadic(),
      Argument.withDescription("The projects to sync (default: the current project)"),
    ),
    all: Flag.Boolean("all").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Sync every project whose source can sync"),
    ),
  },
  Effect.fn(function* ({ names, all }) {
    if (all && names.length > 0) {
      return yield* new UsageError({ message: "pass project names or --all, not both" })
    }

    const hub = yield* Hub
    const outcomes: ReadonlyArray<SyncResult | SyncFailure> = all
      ? yield* hub.syncAll()
      : yield* Effect.gen(function* () {
          const { cwd } = yield* CliContext
          const dir = yield* Dir
          const flag = yield* Project

          if (Option.isSome(dir) && Option.isSome(flag)) {
            return yield* new UsageError({ message: "use --project or --dir, not both" })
          }

          const targets =
            names.length > 0
              ? [...names]
              : [
                  (yield* hub.resolve({
                    ...(Option.isSome(flag) ? { project: flag.value } : {}),
                    ...(Option.isSome(dir) ? { dir: dir.value } : {}),
                    cwd,
                  })).name,
                ]

          return yield* Effect.forEach(targets, (name) =>
            hub
              .sync(name)
              .pipe(
                Effect.catchTag("SyncError", (error) =>
                  Effect.succeed<SyncFailure>({ project: name, error }),
                ),
              ),
          )
        })

    const failed = outcomes.filter((outcome) => "error" in outcome).length

    yield* output(undefined, outcomes, () => outcomes.map(syncLine))

    if (failed > 0) return yield* new SyncFailed({ errors: failed })
  }),
).pipe(
  Command.withDescription("Sync projects with their remotes; exits 1 when any sync failed"),
  Command.withExamples([
    { command: "todo sync", description: "Sync the current project" },
    { command: "todo sync work acme", description: "Sync two projects" },
    { command: "todo sync --all", description: "Sync every project" },
    { command: "todo sync --all --json", description: "Every outcome as JSON" },
  ]),
)

export const projects = Command.make("projects", {}, () => listProjects).pipe(
  Command.withDescription("Work with registered projects: list them, add, remove, rename"),
  Command.withExamples([
    { command: "todo projects", description: "Every project with its sync status" },
    { command: "todo projects add ~/labs/acme", description: "Register a local list" },
    { command: "todo sync --all", description: "Sync every project" },
  ]),
  Command.withSubcommands([projectsLs, projectsAdd, projectsRm, projectsRename]),
)
