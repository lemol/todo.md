import { describe, expect } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { makeClient } from "../../src/jira/index.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, diskWith, md } from "../fs/helpers.ts"
import { adfText, anIssue, type FakeJira, makeFakeJira, statuses } from "../jira/fake.ts"
import { runTodo } from "./harness.ts"

type Run = (...args: ReadonlyArray<string>) => ReturnType<typeof runTodo>

const env = {
  JIRA_SITE: "https://acme.atlassian.net",
  JIRA_EMAIL: "tester@acme.test",
  JIRA_TOKEN: "s3cret",
}

/** Runs `todo` over a list on disk, with `todo jira pull` reaching a fresh fake site. */
const withPull = <A, E>(use: (run: Run, jira: FakeJira) => Effect.Effect<A, E, Disk>) =>
  Effect.gen(function* () {
    const { jira, layer } = makeFakeJira()

    return yield* use(
      (...args) =>
        runTodo(args, {
          env,
          jira: (credentials) =>
            makeClient(credentials, { env }).pipe(
              Effect.provide(layer),
              Effect.provide(BunServices.layer),
            ),
        }),
      jira,
    )
  })

const list = diskWith({ "TODO.md": md("# Work", "", "- [ ] 01 - Mine", "") })

describe("todo jira pull", () => {
  effectTest(
    "adds open issues as tasks with their own IDs and a jira_id",
    withPull((run, jira) =>
      Effect.gen(function* () {
        jira.put(
          anIssue("PROJ-1", { summary: "Rework auth", labels: ["auth"] }),
          anIssue("PROJ-2", { summary: "Write docs", description: adfText("All of them.") }),
          anIssue("PROJ-3", { summary: "Shipped" }, { done: true }),
        )

        const result = yield* run("jira", "pull")

        expect(result).toEqual({
          code: 0,
          stdout: [
            "Added 02  Rework auth  PROJ-1",
            "Added 03  Write docs  PROJ-2",
            "2 added · 0 updated · 0 completed · 0 reopened",
          ].join("\n"),
          stderr: "",
        })

        const disk = yield* Disk

        expect(yield* disk.read("TODO.md")).toBe(
          md(
            "# Work",
            "",
            "- [ ] 01 - Mine",
            "- [ ] 02 - Rework auth",
            "  #auth jira_id:PROJ-1",
            "- [ ] [03 - Write docs](./03-write-docs.md)",
            "",
          ),
        )
        expect(yield* disk.read("03-write-docs.md")).toBe(
          md("---", "title: Write docs", "jira_id: PROJ-2", "---", "All of them."),
        )
      }),
    ),
    list,
  )

  effectTest(
    "is idempotent: a second pull changes nothing",
    withPull((run, jira) =>
      Effect.gen(function* () {
        jira.put(
          anIssue("PROJ-1", { summary: "Rework auth", labels: ["auth"] }),
          anIssue("PROJ-2", { summary: "Write docs", description: adfText("All of them.") }),
        )

        yield* run("jira", "pull")
        const before = yield* (yield* Disk).tree()
        const again = yield* run("jira", "pull")

        expect(again.stdout).toBe("Up to date with Jira")
        expect(yield* (yield* Disk).tree()).toEqual(before)
      }),
    ),
    list,
  )

  effectTest(
    "updates, completes and reopens pulled tasks as their issues change",
    withPull((run, jira) =>
      Effect.gen(function* () {
        jira.put(anIssue("PROJ-1", { summary: "Rework auth" }), anIssue("PROJ-2"))
        yield* run("jira", "pull")

        jira.put(
          anIssue("PROJ-1", { summary: "Rework auth", status: statuses.done }),
          anIssue("PROJ-2", { summary: "Renamed", labels: ["api"] }),
        )

        const result = yield* run("jira", "pull")

        expect(result.stdout).toBe(
          [
            "Updated 03  Renamed  PROJ-2 (title, tags)",
            "Completed 02  Rework auth  PROJ-1",
            "0 added · 1 updated · 1 completed · 0 reopened",
          ].join("\n"),
        )

        jira.put(anIssue("PROJ-1", { summary: "Rework auth" }))

        expect((yield* run("jira", "pull")).stdout).toBe(
          [
            "Reopened 02  Rework auth  PROJ-1",
            "0 added · 0 updated · 0 completed · 1 reopened",
          ].join("\n"),
        )
      }),
    ),
    list,
  )

  effectTest(
    "keeps the list's own work: moves, tags, dependencies and unlinked tasks survive",
    withPull((run, jira) =>
      Effect.gen(function* () {
        jira.put(anIssue("PROJ-1", { summary: "Rework auth" }))
        yield* run("jira", "pull")
        yield* run("edit", "2", "--tag", "mine", "--depends-on", "1")
        yield* run("mv", "2", "--group", "Now")

        jira.put(anIssue("PROJ-1", { summary: "Rework auth", labels: ["api"] }))
        yield* run("jira", "pull")

        const shown = JSON.parse((yield* run("show", "2", "--json")).stdout).view.task

        expect(shown).toMatchObject({
          title: "Rework auth",
          tags: ["mine", "api"],
          dependsOn: ["1"],
          group: "Now",
          extra: { jira_id: "PROJ-1" },
        })
        expect((yield* (yield* Disk).read("TODO.md")).includes("- [ ] 01 - Mine")).toBe(true)
      }),
    ),
    list,
  )

  effectTest(
    "links new tasks to their blockers, even ones added after them",
    withPull((run, jira) =>
      Effect.gen(function* () {
        jira.put(
          anIssue("PROJ-1", {
            issuelinks: [{ type: { name: "Blocks" }, inwardIssue: { key: "PROJ-2" } }],
          }),
          anIssue("PROJ-2"),
        )

        const result = yield* run("jira", "pull")

        expect(result.stdout).toBe(
          [
            "Added 02  PROJ-1  PROJ-1",
            "Added 03  PROJ-2  PROJ-2",
            "2 added · 0 updated · 0 completed · 0 reopened",
          ].join("\n"),
        )

        const shown = JSON.parse((yield* run("show", "2", "--json")).stdout).view.task

        expect(shown.dependsOn).toEqual(["3"])
        expect((yield* run("jira", "pull")).stdout).toBe("Up to date with Jira")
      }),
    ),
    list,
  )

  effectTest(
    "asks Jira about a linked task the query no longer returns, by key",
    withPull((run, jira) =>
      Effect.gen(function* () {
        jira.put(anIssue("PROJ-1"), anIssue("PROJ-2"))
        yield* run("jira", "pull")

        // Done issues fall out of the open query; deleted ones vanish entirely.
        jira.put(anIssue("PROJ-1", { status: statuses.done }))
        jira.remove("PROJ-2")

        const result = yield* run("jira", "pull")

        expect(result.code).toBe(0)
        expect(result.stdout).toBe(
          [
            "Completed 02  PROJ-1  PROJ-1",
            "Missing PROJ-2: Jira no longer shows it; its task is left alone",
            "0 added · 0 updated · 1 completed · 0 reopened",
          ].join("\n"),
        )
        expect(jira.requests.some((request) => request.url.includes("/issue/PROJ-1"))).toBe(true)
      }),
    ),
    list,
  )

  effectTest(
    "puts new tasks in --group, and --dry-run writes nothing",
    withPull((run, jira) =>
      Effect.gen(function* () {
        jira.put(anIssue("PROJ-1", { summary: "Rework auth" }))

        const planned = yield* run("jira", "pull", "--dry-run", "--group", "Jira")

        expect(planned.stdout).toBe(
          [
            "Would add Rework auth  PROJ-1",
            "1 added · 0 updated · 0 completed · 0 reopened (dry run: nothing written)",
          ].join("\n"),
        )
        expect(yield* (yield* Disk).read("TODO.md")).toBe(md("# Work", "", "- [ ] 01 - Mine", ""))

        yield* run("jira", "pull", "--group", "Jira")

        expect(yield* (yield* Disk).read("TODO.md")).toContain(
          md("## Jira", "", "- [ ] 02 - Rework auth", "  jira_id:PROJ-1"),
        )
      }),
    ),
    list,
  )

  effectTest(
    "reports as JSON",
    withPull((run, jira) =>
      Effect.gen(function* () {
        jira.put(anIssue("PROJ-1", { summary: "Rework auth" }))

        const result = yield* run("jira", "pull", "--json")

        expect(JSON.parse(result.stdout)).toEqual({
          changes: [{ kind: "add", key: "PROJ-1", id: "2", title: "Rework auth" }],
          missing: [],
          failures: [],
          dryRun: false,
        })
      }),
    ),
    list,
  )

  effectTest(
    "sends the JQL given, ordered by rank, with the token from the environment",
    withPull((run, jira) =>
      Effect.gen(function* () {
        yield* run("jira", "pull", "--jql", "project = PROJ")

        expect(jira.searches).toEqual(["project = PROJ ORDER BY Rank ASC"])
        expect(jira.lastAuthorization).toBe(`Basic ${btoa("tester@acme.test:s3cret")}`)
      }),
    ),
    list,
  )

  effectTest(
    "changes nothing when Jira cannot be reached",
    withPull((run, jira) =>
      Effect.gen(function* () {
        jira.put(anIssue("PROJ-1"))
        jira.fail("auth")

        const result = yield* run("jira", "pull")

        expect(result.code).toBe(1)
        expect(result.stderr).toContain("Jira refused the credentials")
        expect(yield* (yield* Disk).read("TODO.md")).toBe(md("# Work", "", "- [ ] 01 - Mine", ""))
      }),
    ),
    list,
  )

  effectTest(
    "is a usage error without a site, or with two token sources",
    Effect.gen(function* () {
      const bare = yield* runTodo(["jira", "pull"], {
        jira: () => Effect.die("never reached"),
      })

      expect(bare).toMatchObject({ code: 2, stderr: "error: pass --site or set JIRA_SITE" })

      const both = yield* runTodo(
        ["jira", "pull", "--token-env", "A", "--token-command", "echo b"],
        { env, jira: () => Effect.die("never reached") },
      )

      expect(both).toMatchObject({
        code: 2,
        stderr: "error: use --token-env or --token-command, not both",
      })
    }),
    list,
  )
})
