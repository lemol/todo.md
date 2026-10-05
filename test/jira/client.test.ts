import { describe, expect } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import type { HttpClient } from "effect/http"
import type { ChildProcessSpawner } from "effect/process"
import { type JiraCredentials, makeClient } from "../../src/jira/client.ts"
import type { JiraError } from "../../src/jira/errors.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { anIssue, type FakeJira, makeFakeJira } from "./fake.ts"

const credentials = (
  overrides: Partial<JiraCredentials> = {},
): JiraCredentials & { readonly site: string } => ({
  site: "https://acme.atlassian.net",
  email: "tester@acme.test",
  tokenEnv: "JIRA_TOKEN",
  ...overrides,
})

/** Runs `use` against a fresh fake Jira, with the Bun services a token command needs. */
const withJira = <A, E>(
  use: (
    jira: FakeJira,
  ) => Effect.Effect<A, E, HttpClient.HttpClient | ChildProcessSpawner.ChildProcessSpawner>,
  options: Parameters<typeof makeFakeJira>[0] = {},
): Effect.Effect<A, E> =>
  Effect.suspend(() => {
    const { jira, layer } = makeFakeJira(options)

    return use(jira).pipe(Effect.provide(layer), Effect.provide(BunServices.layer))
  })

const clientWith = (
  overrides: Partial<JiraCredentials> = {},
  env: Record<string, string | undefined> = { JIRA_TOKEN: "s3cret" },
) => makeClient(credentials(overrides), { env })

describe("the Jira client: authentication", () => {
  effectTest(
    "sends basic auth built from the email and the token in the environment",
    withJira((jira) =>
      Effect.gen(function* () {
        const client = yield* clientWith()
        yield* client.myself
        expect(jira.lastAuthorization).toBe(`Basic ${btoa("tester@acme.test:s3cret")}`)
      }),
    ),
  )

  effectTest(
    "takes the token from a command's trimmed output",
    withJira((jira) =>
      Effect.gen(function* () {
        const client = yield* clientWith(
          { tokenEnv: undefined, tokenCommand: "echo '  from-keychain  '" },
          {},
        )

        yield* client.myself
        expect(jira.lastAuthorization).toBe(`Basic ${btoa("tester@acme.test:from-keychain")}`)
      }),
    ),
  )

  effectTest(
    "fails with auth when the environment variable is not set",
    withJira(() =>
      Effect.gen(function* () {
        const client = yield* clientWith({}, {})
        const error = yield* Effect.flip(client.myself)
        expect(error.reason).toBe("auth")
        expect(error.message).toContain("JIRA_TOKEN")
      }),
    ),
  )

  effectTest(
    "fails with auth when the token command fails",
    withJira(() =>
      Effect.gen(function* () {
        const client = yield* clientWith({ tokenEnv: undefined, tokenCommand: "exit 3" }, {})
        const error = yield* Effect.flip(client.myself)
        expect(error.reason).toBe("auth")
      }),
    ),
  )

  effectTest(
    "never puts the token in an error message",
    withJira((jira) =>
      Effect.gen(function* () {
        jira.fail("serverError")
        const client = yield* clientWith()
        const error = yield* Effect.flip(client.myself)
        expect(error.message).not.toContain("s3cret")
      }),
    ),
  )
})

describe("the Jira client: reading", () => {
  effectTest(
    "returns the authenticated account",
    withJira(() =>
      Effect.gen(function* () {
        const client = yield* clientWith()
        expect((yield* client.myself).displayName).toBe("Test User")
      }),
    ),
  )

  effectTest(
    "sends the JQL and the fields it maps",
    withJira((jira) =>
      Effect.gen(function* () {
        jira.put(anIssue("PROJ-1"))
        const client = yield* clientWith()
        const page = yield* client.search({ jql: "assignee = currentUser()" })
        expect(jira.searches).toEqual(["assignee = currentUser()"])
        expect(page.issues?.map((issue) => issue.key)).toEqual(["PROJ-1"])
        const asked = new URL(jira.requests.at(-1)?.url ?? "").searchParams.get("fields")
        expect(asked).toContain("summary")
        expect(asked).toContain("issuelinks")
      }),
    ),
  )

  effectTest(
    "reports the next page token until the last page",
    withJira(
      (jira) =>
        Effect.gen(function* () {
          jira.put(anIssue("PROJ-1"), anIssue("PROJ-2"), anIssue("PROJ-3"))
          const client = yield* clientWith()
          const first = yield* client.search({ jql: "x" })
          expect(first.issues?.length).toBe(2)
          expect(first.nextPageToken).toBe("2")
          const second = yield* client.search({
            jql: "x",
            nextPageToken: first.nextPageToken ?? undefined,
          })

          expect(second.issues?.map((issue) => issue.key)).toEqual(["PROJ-3"])
          expect(second.nextPageToken).toBeUndefined()
        }),
      { pageSize: 2 },
    ),
  )

  effectTest(
    "reads one issue by key",
    withJira((jira) =>
      Effect.gen(function* () {
        jira.put(anIssue("PROJ-9", { summary: "Nine" }))
        const client = yield* clientWith()
        expect((yield* client.issue("PROJ-9")).fields?.summary).toBe("Nine")
      }),
    ),
  )

  effectTest(
    "reads an issue's whole comment page",
    withJira(
      (jira) =>
        Effect.gen(function* () {
          jira.put(
            anIssue("PROJ-9", {
              comment: [
                { id: "1", created: "2026-01-01T09:00:00.000+0000" },
                { id: "2", created: "2026-01-02T09:00:00.000+0000" },
                { id: "3", created: "2026-01-03T09:00:00.000+0000" },
              ],
            }),
          )
          const client = yield* clientWith()
          expect((yield* client.comments("PROJ-9")).map((one) => one.id)).toEqual(["1", "2", "3"])
        }),
      { commentPageSize: 1 },
    ),
  )
})

describe("the Jira client: failures", () => {
  const failsWith = (
    failure: Parameters<FakeJira["fail"]>[0],
    reason: JiraError["reason"],
    part?: string,
  ) =>
    effectTest(
      `maps ${failure} to ${reason}`,
      withJira((jira) =>
        Effect.gen(function* () {
          jira.fail(failure)
          const client = yield* clientWith()
          const error = yield* Effect.flip(client.myself)
          expect(error.reason).toBe(reason)

          if (part !== undefined) expect(error.message).toContain(part)
        }),
      ),
    )

  failsWith("network", "offline")
  failsWith("auth", "auth", "Client must be authenticated")
  failsWith("forbidden", "auth")
  failsWith("rateLimited", "remote", "42")
  failsWith("serverError", "remote", "Jira is having a moment")

  effectTest(
    "maps a missing issue to notFound",
    withJira(() =>
      Effect.gen(function* () {
        const client = yield* clientWith()
        expect((yield* Effect.flip(client.issue("PROJ-404"))).reason).toBe("notFound")
      }),
    ),
  )
})
