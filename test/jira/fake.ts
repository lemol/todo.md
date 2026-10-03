/**
 * A fake Jira Cloud: an in-memory issue table behind an `HttpClient` layer.
 *
 * It answers the REST v3 endpoints `src/jira` uses, with the response shapes
 * from Atlassian's own OpenAPI document, so the suite never touches a network.
 * Nothing here interprets JQL: a query is matched on whether it asks for done
 * issues, which is the only distinction the source makes.
 *
 * Writes follow a three-status workflow (To Do, In Progress, Done) whose
 * transitions a test can replace per status. Timestamps come from `Clock`, so
 * a test's `TestClock` decides them.
 */

import { Clock, DateTime, Effect, Layer } from "effect"
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http"

/** A raw issue payload, as Jira sends it. */
export interface RawIssue {
  readonly id?: string
  readonly key: string
  readonly fields: Record<string, unknown>
}

/** A status as Jira sends it, with its category. */
export interface RawStatus {
  readonly name: string
  readonly statusCategory: { readonly key: string; readonly name: string }
}

export const statuses = {
  toDo: { name: "To Do", statusCategory: { key: "new", name: "To Do" } },
  inProgress: {
    name: "In Progress",
    statusCategory: { key: "indeterminate", name: "In Progress" },
  },
  done: { name: "Done", statusCategory: { key: "done", name: "Done" } },
} satisfies Record<string, RawStatus>

/** A workflow move, as `GET /issue/{key}/transitions` lists it. */
export interface RawTransition {
  readonly id: string
  readonly name: string
  readonly to: RawStatus
}

/** The transitions each status offers until a test says otherwise. */
const defaultWorkflow: Record<string, ReadonlyArray<RawTransition>> = {
  "To Do": [
    { id: "21", name: "Start", to: statuses.inProgress },
    { id: "31", name: "Done", to: statuses.done },
  ],
  "In Progress": [
    { id: "11", name: "Stop", to: statuses.toDo },
    { id: "31", name: "Done", to: statuses.done },
  ],
  Done: [{ id: "41", name: "Reopen", to: statuses.toDo }],
}

/** The user the fake's credentials belong to; the author of every comment added. */
export const myself = { accountId: "5b10a2", displayName: "Test User" }

/** How the fake should misbehave, instead of answering. */
export type Failure = "auth" | "forbidden" | "rateLimited" | "network" | "serverError"

export interface FakeJira {
  readonly site: string
  /** Adds or replaces issues. */
  put(...issues: ReadonlyArray<RawIssue>): void
  remove(key: string): void
  /** Answers every later request with this failure; `undefined` restores it. */
  fail(failure: Failure | undefined): void
  /** The transitions an issue in `status` is offered from now on. */
  workflow(status: string, transitions: ReadonlyArray<RawTransition>): void
  /** An issue's current raw payload. */
  issue(key: string): RawIssue | undefined
  /** Every request the client made, in order, with its JSON body when it had one. */
  readonly requests: ReadonlyArray<{
    readonly method: string
    readonly url: string
    readonly body?: unknown
  }>
  /** The `jql` of every search, in order. */
  readonly searches: ReadonlyArray<string>
  /** The `Authorization` header of the last request. */
  readonly lastAuthorization: string | undefined
}

export interface FakeOptions {
  readonly site?: string
  /** Issues per search page, so pagination is exercised with few issues. */
  readonly pageSize?: number
  /** Comments per embedded page; the rest need `GET /issue/{key}/comment`. */
  readonly commentPageSize?: number
}

/** An issue with the standard fields a test rarely cares about filled in. */
export const anIssue = (
  key: string,
  fields: Record<string, unknown> = {},
  options: { readonly done?: boolean } = {},
): RawIssue => ({
  id: key,
  key,
  fields: {
    summary: key,
    status: options.done === true ? statuses.done : statuses.toDo,
    project: { key: key.split("-")[0] ?? key },
    ...fields,
  },
})

/** A `doc` of one paragraph, the commonest ADF body. */
export const adfText = (value: string) => ({
  type: "doc",
  version: 1,
  content: [{ type: "paragraph", content: [{ type: "text", text: value }] }],
})

const asksForDone = (jql: string) => /statuscategory\s*=\s*done/i.test(jql)

const isDone = (issue: RawIssue): boolean => {
  const status = issue.fields.status as { statusCategory?: { key?: string } } | undefined
  return status?.statusCategory?.key === "done"
}

/** The subset of fields the query asked for, as Jira does with `fields=`. */
const project = (issue: RawIssue, fields: ReadonlyArray<string>, commentPageSize: number) => {
  const wanted = fields.includes("*all")
    ? Object.keys(issue.fields)
    : fields.filter((name) => name in issue.fields)
  const picked: Record<string, unknown> = {}
  for (const name of wanted) {
    if (name !== "comment") {
      picked[name] = issue.fields[name]
      continue
    }
    const comments = (issue.fields.comment as ReadonlyArray<unknown> | undefined) ?? []
    picked.comment = {
      startAt: 0,
      maxResults: commentPageSize,
      total: comments.length,
      comments: comments.slice(0, commentPageSize),
    }
  }
  return { id: issue.id ?? issue.key, key: issue.key, fields: picked }
}

export const makeFakeJira = (
  options: FakeOptions = {},
): { readonly jira: FakeJira; readonly layer: Layer.Layer<HttpClient.HttpClient> } => {
  const site = options.site ?? "https://acme.atlassian.net"
  const pageSize = options.pageSize ?? 50
  const commentPageSize = options.commentPageSize ?? 20
  const issues = new Map<string, RawIssue>()
  const requests: Array<{ method: string; url: string; body?: unknown }> = []
  const workflow = new Map(Object.entries(defaultWorkflow))
  let nextComment = 1000
  const searches: Array<string> = []
  let failure: Failure | undefined
  let lastAuthorization: string | undefined

  const jira: FakeJira = {
    site,
    put: (...added) => {
      for (const issue of added) issues.set(issue.key, issue)
    },
    remove: (key) => {
      issues.delete(key)
    },
    fail: (next) => {
      failure = next
    },
    workflow: (status, transitions) => {
      workflow.set(status, transitions)
    },
    issue: (key) => issues.get(key),
    get requests() {
      return requests
    },
    get searches() {
      return searches
    },
    get lastAuthorization() {
      return lastAuthorization
    },
  }

  const layer = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) => {
      const body =
        request.body._tag === "Uint8Array"
          ? JSON.parse(new TextDecoder().decode(request.body.body))
          : undefined
      requests.push({
        method: request.method,
        url: url.toString(),
        ...(body === undefined ? {} : { body }),
      })
      lastAuthorization = request.headers.authorization

      if (failure === "network") {
        return Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request,
              description: "connect ECONNREFUSED",
            }),
          }),
        )
      }
      const answer = (status: number, payload: unknown, headers?: Record<string, string>) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response(payload === undefined ? null : JSON.stringify(payload), {
              status,
              headers: { "content-type": "application/json", ...headers },
            }),
          ),
        )
      if (failure === "auth") {
        return answer(401, { errorMessages: ["Client must be authenticated"], errors: {} })
      }
      if (failure === "forbidden") return answer(403, { errorMessages: ["Forbidden"], errors: {} })
      if (failure === "rateLimited") {
        return answer(429, { errorMessages: [] }, { "retry-after": "42" })
      }
      if (failure === "serverError") {
        return answer(500, { errorMessages: ["Jira is having a moment"], errors: {} })
      }

      const path = url.pathname.replace(/^\/rest\/api\/3/, "")
      const fields = (url.searchParams.get("fields") ?? "").split(",").filter((one) => one !== "")

      if (path === "/myself") {
        return answer(200, myself)
      }

      if (path === "/search/jql") {
        const jql = url.searchParams.get("jql") ?? ""
        searches.push(jql)
        const matching = [...issues.values()].filter((issue) => isDone(issue) === asksForDone(jql))
        const from = Number(url.searchParams.get("nextPageToken") ?? "0")
        const page = matching.slice(from, from + pageSize)
        const next = from + pageSize
        return answer(200, {
          issues: page.map((issue) => project(issue, fields, commentPageSize)),
          ...(next < matching.length ? { nextPageToken: String(next) } : { isLast: true }),
        })
      }

      const one = /^\/issue\/([^/]+)(\/comment|\/transitions)?$/.exec(path)
      if (one !== null) {
        const key = decodeURIComponent(one[1] ?? "")
        const issue = issues.get(key)
        if (issue === undefined) {
          return answer(404, {
            errorMessages: ["Issue does not exist or you do not have permission to see it."],
            errors: {},
          })
        }
        const status = (issue.fields.status as RawStatus | undefined)?.name ?? ""
        const offered = workflow.get(status) ?? []
        const edited = (changes: Record<string, unknown>) =>
          issues.set(key, { ...issue, fields: { ...issue.fields, ...changes } })

        if (one[2] === "/transitions" && request.method === "GET") {
          return answer(200, { transitions: offered })
        }
        if (one[2] === "/transitions") {
          const id = (body as { transition?: { id?: string } } | undefined)?.transition?.id
          const chosen = offered.find((transition) => transition.id === id)
          if (chosen === undefined) {
            return answer(400, {
              errorMessages: [`Transition id '${id}' is not valid for this issue.`],
              errors: {},
            })
          }
          return Effect.flatMap(DateTime.now, (now) => {
            edited({
              status: chosen.to,
              resolutiondate:
                chosen.to.statusCategory.key === "done" ? DateTime.formatIso(now) : null,
            })
            return answer(204, undefined)
          })
        }
        if (one[2] === "/comment" && request.method === "POST") {
          return Effect.flatMap(Clock.currentTimeMillis, (millis) => {
            const created = {
              id: String(nextComment++),
              author: myself,
              created: new Date(millis).toISOString(),
              body: (body as { body?: unknown } | undefined)?.body,
            }
            const existing = (issue.fields.comment as ReadonlyArray<unknown> | undefined) ?? []
            edited({ comment: [...existing, created] })
            return answer(201, created)
          })
        }
        if (one[2] === undefined && request.method === "PUT") {
          const changes = (body as { fields?: Record<string, unknown> } | undefined)?.fields ?? {}
          const unknown = Object.keys(changes).filter(
            (name) => !["summary", "labels"].includes(name),
          )
          if (unknown.length > 0) {
            return answer(400, {
              errorMessages: [],
              errors: Object.fromEntries(unknown.map((name) => [name, "not editable here"])),
            })
          }
          edited(changes)
          return answer(204, undefined)
        }
        if (one[2] === undefined) return answer(200, project(issue, fields, commentPageSize))
        const comments = (issue.fields.comment as ReadonlyArray<unknown> | undefined) ?? []
        return answer(200, {
          startAt: 0,
          maxResults: comments.length,
          total: comments.length,
          comments,
        })
      }

      return answer(404, { errorMessages: [`no route for ${path}`], errors: {} })
    }),
  )

  return { jira, layer }
}
