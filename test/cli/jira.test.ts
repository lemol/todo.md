import { describe, expect } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { type AnySource, fsSource } from "../../src/hub/index.ts"
import { JiraSource } from "../../src/jira/index.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, diskWith } from "../fs/helpers.ts"
import { adfText, anIssue, type FakeJira, makeFakeJira } from "../jira/fake.ts"
import { runTodo } from "./harness.ts"

/** Runs `todo` against a fresh fake Jira site, sharing one hub home. */
type Run = (...args: ReadonlyArray<string>) => ReturnType<typeof runTodo>

const withCli = <A, E>(use: (run: Run, jira: FakeJira) => Effect.Effect<A, E, Disk>) =>
  Effect.gen(function* () {
    const { root } = yield* Disk
    const { jira, layer } = makeFakeJira()
    const sources: ReadonlyArray<AnySource> = [
      fsSource,
      yield* JiraSource.make({ env: { JIRA_TOKEN: "s3cret" } }).pipe(Effect.provide(layer)),
    ]
    const home = `${root}/hub`
    return yield* use((...args) => runTodo(args, { home, sources }), jira)
  }).pipe(Effect.provide(BunServices.layer))

describe("jira projects from the CLI", () => {
  effectTest(
    "registers a site, mirrors it on add, and lists its issues",
    withCli((run, jira) =>
      Effect.gen(function* () {
        jira.put(
          anIssue("PROJ-1", { summary: "Rework auth", description: adfText("Tokens expire.") }),
          anIssue("PROJ-2", { summary: "Ship it" }, { done: true }),
        )
        const added = yield* run(
          "projects",
          "add",
          jira.site,
          "--source",
          "jira",
          "--name",
          "work",
          "--email",
          "tester@acme.test",
          "--token-env",
          "JIRA_TOKEN",
        )
        expect(added.stderr).toBe("")
        expect(added.code).toBe(0)

        const listed = yield* run("--project", "work", "ls")
        expect(listed.code).toBe(0)
        expect(listed.stdout).toContain("Rework auth")
        expect(listed.stdout).not.toContain("Ship it")

        const shown = yield* run("show", "work:PROJ-1")
        expect(shown.stdout).toContain("Tokens expire.")

        const projects = yield* run("projects")
        expect(projects.stdout).toContain("jira")
        expect(projects.stdout).toContain(jira.site)
      }),
    ),
    diskWith({}),
  )

  effectTest(
    "syncs a registered site again on demand",
    withCli((run, jira) =>
      Effect.gen(function* () {
        jira.put(anIssue("PROJ-1"))
        yield* run(
          "projects",
          "add",
          jira.site,
          "--source",
          "jira",
          "--name",
          "work",
          "--email",
          "tester@acme.test",
          "--token-env",
          "JIRA_TOKEN",
        )
        jira.put(anIssue("PROJ-2"), anIssue("PROJ-3", {}, { done: true }))
        const synced = yield* run("sync", "work")
        expect(synced.code).toBe(0)
        expect(synced.stdout).toContain("2 open, 1 done")
        expect((yield* run("--project", "work", "ls")).stdout).toContain("PROJ-2")
      }),
    ),
    diskWith({}),
  )

  effectTest(
    "completes, reopens, comments on and edits an issue, and shows the new state straight away",
    withCli((run, jira) =>
      Effect.gen(function* () {
        jira.put(anIssue("PROJ-1", { summary: "Rework auth", labels: ["api"] }))
        yield* run(
          "projects",
          "add",
          jira.site,
          "--source",
          "jira",
          "--name",
          "work",
          "--email",
          "tester@acme.test",
          "--token-env",
          "JIRA_TOKEN",
        )

        const done = yield* run("done", "work:PROJ-1")
        expect(done.stderr).toBe("")
        expect(done.code).toBe(0)
        expect(jira.issue("PROJ-1")?.fields.status).toMatchObject({ name: "Done" })
        expect((yield* run("--project", "work", "ls")).stdout).not.toContain("Rework auth")

        const reopened = yield* run("reopen", "work:PROJ-1")
        expect(reopened.code).toBe(0)
        expect((yield* run("--project", "work", "ls")).stdout).toContain("Rework auth")

        const commented = yield* run(
          "comment",
          "work:PROJ-1",
          "Tokens",
          "expire",
          "--author",
          "ana",
        )
        expect(commented.stderr).toBe("")
        expect(commented.code).toBe(0)
        const shown = yield* run("show", "work:PROJ-1")
        expect(shown.stdout).toContain("Tokens expire")
        expect(shown.stdout).toContain("test-user")

        const edited = yield* run(
          "edit",
          "work:PROJ-1",
          "--title",
          "Rework sessions",
          "--tag",
          "backend",
        )
        expect(edited.stderr).toBe("")
        expect(edited.code).toBe(0)
        expect(jira.issue("PROJ-1")?.fields).toMatchObject({
          summary: "Rework sessions",
          labels: ["api", "backend"],
        })
        const listed = (yield* run("--project", "work", "ls")).stdout
        expect(listed).toContain("Rework sessions")
        expect(listed).toContain("backend")
      }),
    ),
    diskWith({}),
  )

  effectTest(
    "refuses to edit what Jira keeps, and sends nothing",
    withCli((run, jira) =>
      Effect.gen(function* () {
        jira.put(anIssue("PROJ-1"))
        yield* run(
          "projects",
          "add",
          jira.site,
          "--source",
          "jira",
          "--name",
          "work",
          "--email",
          "tester@acme.test",
          "--token-env",
          "JIRA_TOKEN",
        )
        const refused = yield* run("edit", "work:PROJ-1", "--description", "More.")
        expect(refused.code).not.toBe(0)
        expect(refused.stderr).toContain("description is read-only for Jira projects")
        expect(jira.requests.filter((request) => request.method !== "GET")).toEqual([])
      }),
    ),
    diskWith({}),
  )

  effectTest(
    "reports a site that refuses the credentials, and registers nothing",
    withCli((run, jira) =>
      Effect.gen(function* () {
        jira.fail("auth")
        const refused = yield* run(
          "projects",
          "add",
          jira.site,
          "--source",
          "jira",
          "--name",
          "work",
          "--email",
          "tester@acme.test",
          "--token-env",
          "JIRA_TOKEN",
        )
        expect(refused.code).not.toBe(0)
        expect(refused.stderr).toContain("credentials")
        expect((yield* run("projects")).stdout).toContain("No projects registered")
      }),
    ),
    diskWith({}),
  )

  effectTest(
    "wants a name, since a site is not one",
    withCli((run, jira) =>
      Effect.gen(function* () {
        const unnamed = yield* run(
          "projects",
          "add",
          jira.site,
          "--source",
          "jira",
          "--email",
          "tester@acme.test",
          "--token-env",
          "JIRA_TOKEN",
        )
        expect(unnamed.code).not.toBe(0)
        expect(unnamed.stderr).toContain("name")
      }),
    ),
    diskWith({}),
  )

  effectTest(
    "refuses jira's flags on a project of another source",
    withCli((run) =>
      Effect.gen(function* () {
        const { root } = yield* Disk
        const wrong = yield* run("projects", "add", root, "--email", "tester@acme.test")
        expect(wrong.code).toBe(2)
        expect(wrong.stderr).toContain("--email")
      }),
    ),
    diskWith({ "todo/TODO.md": "# Local\n" }),
  )

  effectTest(
    "wants one way to reach the token",
    withCli((run, jira) =>
      Effect.gen(function* () {
        const neither = yield* run(
          "projects",
          "add",
          jira.site,
          "--source",
          "jira",
          "--name",
          "work",
          "--email",
          "tester@acme.test",
        )
        expect(neither.code).not.toBe(0)
        expect(neither.stderr).toContain("token_env")
      }),
    ),
    diskWith({}),
  )
})
