/**
 * The Jira source: a project whose tasks are the issues two JQL queries
 * return, mirrored locally on `sync`. See
 * [the hub design](../../docs/superpowers/specs/2026-09-13-hub-design.md#jira-srcjira-lemoltodo-mdjira).
 */

import { DateTime, Effect, Layer, Schema, Stream } from "effect"
import type { HttpClient } from "effect/http"
import type { ChildProcessSpawner } from "effect/process"
import {
  type Source,
  type SourceEnv,
  SourceError,
  type SourceProject,
  SyncError,
  type SyncOutcome,
  watchList,
} from "../hub/index.ts"
import type { Task } from "../spec/index.ts"
import { TodoStore } from "../spec/index.ts"
import { type JiraClient, type JiraCredentials, makeClient } from "./client.ts"
import { asSyncError, type JiraError } from "./errors.ts"
import type { Issue } from "./mapping.ts"
import { mirrorFile, writeMirror } from "./mirror.ts"
import * as JiraTodoStore from "./store.ts"
import { taskFor } from "./store.ts"

const filled = (what: string) =>
  Schema.makeFilter((value: string) => value.trim() !== "" || `must be a ${what}`)

/** Exactly one way to get the token: neither is unusable, both is ambiguous. */
const oneTokenSource = Schema.makeFilter(
  (config: {
    readonly token_env?: string | undefined
    readonly token_command?: string | undefined
  }) =>
    (config.token_env === undefined) !== (config.token_command === undefined) ||
    "needs exactly one of token_env and token_command",
)

/** `{ site, email, token_env | token_command, jql?, … }`: a site and how to reach it. */
export const JiraConfig = Schema.Struct({
  site: Schema.String.check(filled("Jira site, e.g. https://acme.atlassian.net")),
  email: Schema.String.check(filled("Jira account email")),
  /** The environment variable holding the API token. */
  token_env: Schema.optional(Schema.String),
  /** A command printing the API token, for a keychain or a secret manager. */
  token_command: Schema.optional(Schema.String),
  jql: Schema.optional(Schema.String),
  done_jql: Schema.optional(Schema.String),
  /** The transition to use for `complete`, when its name is not the obvious one. */
  done_transition: Schema.optional(Schema.String),
  reopen_transition: Schema.optional(Schema.String),
  /**
   * Never write to Jira: the project is read and synced only, and complete,
   * reopen, edit and comment fail. For a site whose workflow is not ours.
   */
  read_only: Schema.optional(Schema.Boolean),
}).check(oneTokenSource)
export type JiraConfig = typeof JiraConfig.Type

export const defaultJql = "assignee = currentUser() AND statusCategory != Done"
export const defaultDoneJql =
  "assignee = currentUser() AND statusCategory = Done AND resolved >= -30d"

/** Adds an order to a query that has none, so paging is stable and the list reads sensibly. */
export const orderedBy = (jql: string, order: string): string =>
  /\border\s+by\b/i.test(jql) ? jql : `${jql} ORDER BY ${order}`

/** The two queries a sync runs: the project's open tasks, and its done ones. */
export const queriesOf = (config: JiraConfig): { open: string; done: string } => ({
  open: orderedBy(config.jql ?? defaultJql, "Rank ASC"),
  done: orderedBy(config.done_jql ?? defaultDoneJql, "resolved DESC"),
})

export const credentialsOf = (config: JiraConfig): JiraCredentials => ({
  site: config.site,
  email: config.email,
  tokenEnv: config.token_env,
  tokenCommand: config.token_command,
})

/** A runaway `nextPageToken` must not loop forever; 200 pages is far past any real list. */
const pageLimit = 200

/**
 * A `Source` over Jira, built from a way to make clients rather than from
 * `HttpClient` itself, so the hub never sees an HTTP requirement.
 */
export const jiraSourceWith = (
  clientFor: (config: JiraConfig) => Effect.Effect<JiraClient>,
): Source<JiraConfig> => {
  /** A Jira project always has a data directory; only unregistered projects lack one. */
  const located = (project: SourceProject<JiraConfig>): Effect.Effect<string, SourceError> =>
    project.dir === undefined
      ? Effect.fail(
          new SourceError({
            name: project.name,
            message: "a jira project must be registered before it can be opened",
          }),
        )
      : Effect.succeed(project.dir)

  const openedStore = (project: SourceProject<JiraConfig>) =>
    Effect.gen(function* () {
      const dir = yield* located(project)
      const client = yield* clientFor(project.config)

      return JiraTodoStore.layer({
        name: project.name,
        dir,
        site: project.config.site,
        client,
        doneTransition: project.config.done_transition,
        reopenTransition: project.config.reopen_transition,
        readOnly: project.config.read_only === true,
      })
    })

  /** Every page of one query, as tasks. */
  const fetchAll = (
    client: JiraClient,
    jql: string,
    site: string,
  ): Effect.Effect<ReadonlyArray<Task>, JiraError> =>
    Effect.gen(function* () {
      const issues: Array<Issue> = []
      let token: string | undefined

      for (let page = 0; page < pageLimit; page++) {
        const result = yield* client.search({
          jql,
          ...(token === undefined ? {} : { nextPageToken: token }),
        })

        issues.push(...(result.issues ?? []))
        token = result.nextPageToken ?? undefined

        if (token === undefined) break
      }

      return yield* Effect.forEach(issues, (issue) => taskFor(client, issue, site))
    })

  /** Both queries, written to the mirror. The mirror is replaced only once both succeeded. */
  const refresh = (
    project: SourceProject<JiraConfig>,
  ): Effect.Effect<SyncOutcome, SyncError, SourceEnv> =>
    Effect.gen(function* () {
      const dir = yield* located(project).pipe(
        Effect.mapError(
          (error) =>
            new SyncError({ project: project.name, reason: "remote", message: error.message }),
        ),
      )

      const client = yield* clientFor(project.config)
      const queries = queriesOf(project.config)
      const site = project.config.site
      const startedAt = yield* DateTime.now
      const { open, done } = yield* Effect.gen(function* () {
        const open = yield* fetchAll(client, queries.open, site)
        const done = yield* fetchAll(client, queries.done, site)

        return { open, done }
      }).pipe(Effect.mapError((error) => asSyncError(project.name, error)))

      const syncedAt = yield* DateTime.now

      yield* writeMirror(dir, { version: 1, syncedAt, open, done }, startedAt).pipe(
        Effect.mapError(
          (error) =>
            new SyncError({ project: project.name, reason: "remote", message: error.message }),
        ),
      )

      return { summary: `${open.length} open, ${done.length} done` } satisfies SyncOutcome
    })

  return {
    kind: "jira",
    config: JiraConfig,
    // No `defaultName`: a site hosts every project, so the name is the user's to pick.
    location: (config) => config.site,

    prepare: (project) =>
      Effect.gen(function* () {
        const client = yield* clientFor(project.config)

        yield* client.myself.pipe(
          Effect.mapError(
            (error) =>
              new SourceError({
                name: project.name,
                message: `Jira did not accept the credentials for ${project.config.site}: ${error.message}`,
              }),
          ),
        )
        yield* refresh(project).pipe(
          Effect.mapError(
            (error) => new SourceError({ name: project.name, message: error.message }),
          ),
        )
      }),

    open: (project) =>
      Layer.unwrap(
        Effect.map(openedStore(project), (store) =>
          // A store is built eagerly, so a project with no mirror says so when
          // it is opened rather than on the first read.
          Layer.effect(
            TodoStore,
            Effect.flatMap(TodoStore, (service) =>
              Effect.map(service.load(), () => service).pipe(
                Effect.mapError(
                  (error) => new SourceError({ name: project.name, message: error.message }),
                ),
              ),
            ),
          ).pipe(Layer.provide(store)),
        ),
      ),

    sync: refresh,

    changes: (project) => {
      const stop = (reason: string): Stream.Stream<void, never, SourceEnv> =>
        Stream.drain(
          Stream.fromEffect(Effect.logWarning(`stopped watching ${project.name}: ${reason}`)),
        )

      // The hub keeps its own `state.json` in the same directory and rewrites
      // it after every sync; only the mirror is a change to the list.
      return project.dir === undefined
        ? stop(`${project.name} is not registered`)
        : watchList(project.dir, {
            ignore: (path) => !path.split(/[\\/]/).includes(mirrorFile),
          }).pipe(Stream.catch((error) => stop(error.message)))
    },
  }
}

export interface JiraOptions {
  /** The environment a project's `token_env` is read from. */
  readonly env?: Readonly<Record<string, string | undefined>> | undefined
}

/**
 * Builds the Jira source. Run it at the composition root, where `HttpClient`
 * and `ChildProcessSpawner` are available.
 */
export const make = (
  options: JiraOptions = {},
): Effect.Effect<
  Source<JiraConfig>,
  never,
  HttpClient.HttpClient | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const services = yield* Effect.context<
      HttpClient.HttpClient | ChildProcessSpawner.ChildProcessSpawner
    >()

    return jiraSourceWith((config) =>
      makeClient(credentialsOf(config), { env: options.env }).pipe(Effect.provideContext(services)),
    )
  })
