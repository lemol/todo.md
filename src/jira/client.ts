/**
 * Jira Cloud REST v3 over Effect's `HttpClient`.
 *
 * The token is resolved for every call and never kept: an environment
 * variable is read when it is needed, and a token command is run then. Only
 * the reading half of the API lives here; mutations arrive with the store's.
 */

import { Effect, Schema, Stream } from "effect"
import { HttpClient, type HttpClientError } from "effect/unstable/http"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { JiraError } from "./errors.ts"
import {
  CommentPage,
  Issue,
  issueFields,
  type JiraComment,
  JiraUser,
  SearchPage,
} from "./mapping.ts"

/** Where the site is and how to authenticate against it. */
export interface JiraCredentials {
  readonly site: string
  readonly email: string
  /** The environment variable holding the API token. */
  readonly tokenEnv?: string | undefined
  /** A command whose output is the API token, run through a shell. */
  readonly tokenCommand?: string | undefined
}

export interface JiraClientOptions {
  /** The environment `token_env` is read from. */
  readonly env?: Readonly<Record<string, string | undefined>> | undefined
}

export interface SearchQuery {
  readonly jql: string
  /** The page to fetch; absent asks for the first. */
  readonly nextPageToken?: string | undefined
}

export interface JiraClient {
  /** The account the credentials belong to; the cheapest way to check them. */
  readonly myself: Effect.Effect<JiraUser, JiraError>
  search(query: SearchQuery): Effect.Effect<SearchPage, JiraError>
  issue(key: string): Effect.Effect<Issue, JiraError>
  /** Every comment on an issue, for when the issue's embedded page was truncated. */
  comments(key: string): Effect.Effect<ReadonlyArray<JiraComment>, JiraError>
}

const ErrorBody = Schema.Struct({
  errorMessages: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
})

/** Jira's own explanation of a failure, when it sent one. */
const explain = (body: unknown): string | undefined => {
  const decoded = Schema.decodeUnknownOption(ErrorBody)(body)
  const messages = decoded._tag === "Some" ? (decoded.value.errorMessages ?? []) : []
  return messages.length === 0 ? undefined : messages.join("; ")
}

/** A token command's output, run through a shell so a config line works as typed. */
const fromCommand = Effect.fn("jira.fromCommand")(function* (command: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const handle = yield* spawner.spawn(ChildProcess.make(command, [], { shell: true }))
  const [stdout, code] = yield* Effect.all(
    [Stream.mkString(Stream.decodeText(handle.stdout)), handle.exitCode],
    { concurrency: "unbounded" },
  )
  if (code !== 0) {
    return yield* new JiraError({
      reason: "auth",
      message: `the token command failed (${code}): ${command}`,
    })
  }
  return stdout.trim()
})

const resolveToken = (
  credentials: JiraCredentials,
  options: JiraClientOptions,
): Effect.Effect<string, JiraError, ChildProcessSpawner.ChildProcessSpawner> => {
  const { tokenEnv, tokenCommand } = credentials
  if (tokenCommand !== undefined) {
    return fromCommand(tokenCommand).pipe(
      Effect.scoped,
      Effect.catchTag(
        "PlatformError",
        (cause) =>
          new JiraError({
            reason: "auth",
            message: `could not run the token command: ${cause.message}`,
          }),
      ),
      Effect.flatMap((token) =>
        token === ""
          ? new JiraError({ reason: "auth", message: "the token command printed nothing" })
          : Effect.succeed(token),
      ),
    )
  }
  if (tokenEnv === undefined) {
    return Effect.fail(
      new JiraError({ reason: "auth", message: "no token: set token_env or token_command" }),
    )
  }
  const token = options.env?.[tokenEnv]
  return token === undefined || token === ""
    ? Effect.fail(new JiraError({ reason: "auth", message: `${tokenEnv} is not set` }))
    : Effect.succeed(token)
}

/** An `HttpClientError` as a `JiraError`, with Jira's own words when it sent any. */
const failureOf = Effect.fn("jira.failureOf")(function* (
  error: HttpClientError.HttpClientError,
  issue: string | undefined,
) {
  const at = issue === undefined ? {} : { issue }
  const response = error.response
  if (response === undefined) {
    return new JiraError({
      reason: "offline",
      message: `could not reach Jira: ${error.message}`,
      ...at,
    })
  }
  const body = yield* Effect.orElseSucceed(response.json, () => undefined)
  const said = explain(body)
  const detail = said === undefined ? `HTTP ${response.status}` : said
  if (response.status === 401 || response.status === 403) {
    return new JiraError({
      reason: "auth",
      message: `Jira refused the credentials: ${detail}`,
      ...at,
    })
  }
  if (response.status === 404) {
    return new JiraError({ reason: "notFound", message: detail, ...at })
  }
  if (response.status === 429) {
    const after = response.headers["retry-after"]
    const wait = after === undefined ? "" : `; retry after ${after}s`
    return new JiraError({
      reason: "remote",
      message: `Jira is rate limiting this site${wait}`,
      ...at,
    })
  }
  return new JiraError({
    reason: "remote",
    message: `Jira returned ${response.status}: ${detail}`,
    ...at,
  })
})

/**
 * A client for one site. Built at the composition root, where `HttpClient` and
 * `ChildProcessSpawner` are available, so the hub never sees either.
 */
export const makeClient = (
  credentials: JiraCredentials,
  options: JiraClientOptions = {},
): Effect.Effect<
  JiraClient,
  never,
  HttpClient.HttpClient | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
    const base = `${credentials.site.replace(/\/+$/, "")}/rest/api/3`
    const token = resolveToken(credentials, options).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    )
    const fields = issueFields.join(",")

    /** One GET, decoded. The token is resolved here, so it lives no longer than the call. */
    const get = <S extends Schema.Top & { readonly DecodingServices: never }>(
      path: string,
      schema: S,
      query: Readonly<Record<string, string>> = {},
      issue?: string,
    ): Effect.Effect<S["Type"], JiraError> =>
      Effect.gen(function* () {
        const secret = yield* token
        const response = yield* http.get(`${base}${path}`, {
          urlParams: query,
          headers: {
            accept: "application/json",
            authorization: `Basic ${btoa(`${credentials.email}:${secret}`)}`,
          },
        })
        return yield* Schema.decodeUnknownEffect(schema)(yield* response.json)
      }).pipe(
        Effect.catchTag("HttpClientError", (error) =>
          Effect.flatMap(failureOf(error, issue), Effect.fail),
        ),
        Effect.catchTag("SchemaError", (error) =>
          Effect.fail(
            new JiraError({
              reason: "remote",
              message: `Jira sent something this version does not understand: ${error.message}`,
              ...(issue === undefined ? {} : { issue }),
            }),
          ),
        ),
      )

    const at = (key: string, suffix = "") => `/issue/${encodeURIComponent(key)}${suffix}`

    /** Comment pages until the last one: an issue's embedded page holds only the first few. */
    const commentsFrom = (
      key: string,
      startAt: number,
      collected: ReadonlyArray<JiraComment>,
    ): Effect.Effect<ReadonlyArray<JiraComment>, JiraError> =>
      Effect.flatMap(
        get(at(key, "/comment"), CommentPage, { startAt: String(startAt), maxResults: "100" }, key),
        (page) => {
          const comments = [...collected, ...(page.comments ?? [])]
          const total = page.total ?? comments.length
          return comments.length >= total || (page.comments ?? []).length === 0
            ? Effect.succeed(comments)
            : commentsFrom(key, comments.length, comments)
        },
      )

    return {
      myself: get("/myself", JiraUser),
      search: (query) =>
        get("/search/jql", SearchPage, {
          jql: query.jql,
          fields,
          maxResults: "100",
          ...(query.nextPageToken === undefined ? {} : { nextPageToken: query.nextPageToken }),
        }),
      issue: (key) => get(at(key), Issue, { fields }, key),
      comments: (key) => commentsFrom(key, 0, []),
    } satisfies JiraClient
  })
