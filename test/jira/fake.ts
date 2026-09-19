/**
 * A fake Jira Cloud: an in-memory issue table behind an `HttpClient` layer.
 *
 * It answers the REST v3 endpoints `src/jira` uses, with the response shapes
 * from Atlassian's own OpenAPI document, so the suite never touches a network.
 * Nothing here interprets JQL: a query is matched on whether it asks for done
 * issues, which is the only distinction the source makes.
 */

import { Effect, Layer } from "effect"
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/unstable/http"

/** A raw issue payload, as Jira sends it. */
export interface RawIssue {
  readonly id?: string
  readonly key: string
  readonly fields: Record<string, unknown>
}

/** How the fake should misbehave, instead of answering. */
export type Failure = "auth" | "forbidden" | "rateLimited" | "network" | "serverError"

export interface FakeJira {
  readonly site: string
  /** Adds or replaces issues. */
  put(...issues: ReadonlyArray<RawIssue>): void
  remove(key: string): void
  /** Answers every later request with this failure; `undefined` restores it. */
  fail(failure: Failure | undefined): void
  /** Every request the client made, in order. */
  readonly requests: ReadonlyArray<{ readonly method: string; readonly url: string }>
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
    status:
      options.done === true
        ? { name: "Done", statusCategory: { key: "done", name: "Done" } }
        : { name: "To Do", statusCategory: { key: "new", name: "To Do" } },
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
  const requests: Array<{ method: string; url: string }> = []
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
      requests.push({ method: request.method, url: url.toString() })
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
      const answer = (status: number, body: unknown, headers?: Record<string, string>) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response(JSON.stringify(body), {
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
        return answer(200, { accountId: "5b10a2", displayName: "Test User" })
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

      const one = /^\/issue\/([^/]+)(\/comment)?$/.exec(path)
      if (one !== null) {
        const issue = issues.get(decodeURIComponent(one[1] ?? ""))
        if (issue === undefined) {
          return answer(404, {
            errorMessages: ["Issue does not exist or you do not have permission to see it."],
            errors: {},
          })
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
