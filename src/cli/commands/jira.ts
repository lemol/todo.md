import { Effect, Option } from "effect"
import { Command, Flag } from "effect/cli"
import {
  defaultJql,
  type JiraCredentials,
  orderedBy,
  type PullEntry,
  type PullReport,
  pull,
} from "../../jira/index.ts"
import { CliContext, output, warnUnpushed, withTodo } from "../context.ts"
import { describeError, errorJson, PullFailed, UsageError } from "../errors.ts"
import { showId } from "../render.ts"
import type { Style } from "../style.ts"

const optional = (name: string, description: string) =>
  Flag.String(name).pipe(Flag.optional, Flag.withDescription(description))

const flagged = (name: string, description: string) =>
  Flag.Boolean(name).pipe(Flag.withDefault(false), Flag.withDescription(description))

/** The token variable when neither --token-env nor --token-command says otherwise. */
const defaultTokenEnv = "JIRA_TOKEN"

/** A flag's value, else an environment variable's; neither is a usage error naming both. */
const flagOrEnv = (flag: Option.Option<string>, name: string, variable: string) =>
  Effect.gen(function* () {
    const { env } = yield* CliContext
    const value = Option.isSome(flag) ? flag.value : env[variable]

    if (value === undefined || value.trim() === "") {
      return yield* new UsageError({ message: `pass --${name} or set ${variable}` })
    }

    return value.trim()
  })

const verbs: Record<PullEntry["kind"], readonly [done: string, planned: string]> = {
  add: ["Added", "Would add"],
  update: ["Updated", "Would update"],
  complete: ["Completed", "Would complete"],
  reopen: ["Reopened", "Would reopen"],
}

const entryLine = (entry: PullEntry, dryRun: boolean, style: Style) => {
  const verb = verbs[entry.kind][dryRun ? 1 : 0]
  const id = entry.id === undefined ? "" : `${showId(entry.id)}  `
  const fields = entry.fields === undefined ? "" : style.dim(` (${entry.fields.join(", ")})`)

  return `${verb} ${id}${entry.title}  ${style.dim(entry.key)}${fields}`
}

const count = (report: PullReport, kind: PullEntry["kind"]) =>
  report.changes.filter((entry) => entry.kind === kind).length

const renderPull = (report: PullReport, dryRun: boolean, style: Style): string[] => {
  const summary = [
    `${count(report, "add")} added`,
    `${count(report, "update")} updated`,
    `${count(report, "complete")} completed`,
    `${count(report, "reopen")} reopened`,
    ...(report.failures.length === 0 ? [] : [`${report.failures.length} failed`]),
  ].join(" · ")

  return [
    ...report.changes.map((entry) => entryLine(entry, dryRun, style)),
    ...report.missing.map(
      (key) => `${style.yellow("Missing")} ${key}: Jira no longer shows it; its task is left alone`,
    ),
    ...report.failures.map(
      (failure) =>
        `${style.red("Failed")} ${failure.key} (${failure.kind}): ${describeError(failure.error)}`,
    ),
    report.changes.length === 0 && report.failures.length === 0
      ? "Up to date with Jira"
      : dryRun
        ? `${summary} (dry run: nothing written)`
        : summary,
  ]
}

export const jiraPull = Command.make(
  "pull",
  {
    jql: optional("jql", "The issues to pull (default: assigned to you and not done, by rank)"),
    site: optional(
      "site",
      "The Jira Cloud site, e.g. https://acme.atlassian.net (default: $JIRA_SITE)",
    ),
    email: optional("email", "The account the API token belongs to (default: $JIRA_EMAIL)"),
    tokenEnv: optional(
      "token-env",
      `The environment variable holding the API token (default: ${defaultTokenEnv})`,
    ),
    tokenCommand: optional(
      "token-command",
      "A command printing the API token, e.g. from a keychain, instead of --token-env",
    ),
    group: optional("group", "Add new tasks to this group (created if missing)"),
    inline: flagged(
      "inline",
      "Keep new tasks in TODO.md even when they have a description (default: their own file)",
    ),
    dryRun: flagged("dry-run", "Show what would change, and write nothing"),
  },
  Effect.fn(function* ({ jql, site, email, tokenEnv, tokenCommand, group, inline, dryRun }) {
    if (Option.isSome(tokenEnv) && Option.isSome(tokenCommand)) {
      return yield* new UsageError({ message: "use --token-env or --token-command, not both" })
    }

    const context = yield* CliContext

    if (context.jira === undefined) {
      return yield* new UsageError({ message: "Jira is not available in this build of todo" })
    }

    const credentials: JiraCredentials = {
      site: yield* flagOrEnv(site, "site", "JIRA_SITE"),
      email: yield* flagOrEnv(email, "email", "JIRA_EMAIL"),
      ...(Option.isSome(tokenCommand)
        ? { tokenCommand: tokenCommand.value }
        : { tokenEnv: Option.getOrElse(tokenEnv, () => defaultTokenEnv) }),
    }

    const client = yield* context.jira(credentials)

    yield* withTodo((todo, info) =>
      Effect.gen(function* () {
        const report = yield* pull(client, todo, {
          site: credentials.site,
          jql: orderedBy(
            Option.getOrElse(jql, () => defaultJql),
            "Rank ASC",
          ),
          group: Option.getOrUndefined(group),
          files: !inline && todo.capabilities.promote,
          dryRun,
        })

        const json = {
          ...report,
          dryRun,
          failures: report.failures.map((failure) => ({
            ...failure,
            error: errorJson(failure.error),
          })),
        }

        yield* output(info, json, (style) => renderPull(report, dryRun, style))

        if (!dryRun && report.changes.length > 0) yield* warnUnpushed(info)

        if (report.failures.length > 0) {
          return yield* new PullFailed({ errors: report.failures.length })
        }
      }),
    )
  }),
).pipe(
  Command.withDescription(
    "Copy Jira issues into this list, one way: new issues become tasks with their own IDs and a jira_id, and pulled tasks follow their issue",
  ),
  Command.withExamples([
    {
      command: "JIRA_SITE=https://acme.atlassian.net JIRA_EMAIL=me@acme.test todo jira pull",
      description: "Pull the open issues assigned to you, with the token in $JIRA_TOKEN",
    },
    {
      command: "todo jira pull --jql 'project = PROJ AND sprint in openSprints()' --group Sprint",
      description: "Pull this sprint's issues into the Sprint group",
    },
    {
      command:
        "todo jira pull --site https://acme.atlassian.net --email me@acme.test --token-command 'security find-generic-password -s jira -w'",
      description: "Take the token from the macOS keychain",
    },
    { command: "todo jira pull --dry-run", description: "See what a pull would change first" },
    { command: "todo jira pull --json", description: "The report as JSON" },
  ]),
)

export const jira = Command.make("jira").pipe(
  Command.withDescription("Bring Jira issues into a todo.md list"),
  Command.withExamples([
    { command: "todo jira pull", description: "Pull your open issues into the current list" },
    { command: "todo jira pull --help", description: "Every option of a pull" },
  ]),
  Command.withSubcommands([jiraPull]),
)
