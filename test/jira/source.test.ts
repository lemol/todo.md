import { describe, expect } from "bun:test"
import { Effect, FileSystem, Option, Queue, Schema, Stream } from "effect"
import type { SyncError } from "../../src/hub/index.ts"
import { JiraConfig, orderedBy, queriesOf } from "../../src/jira/JiraSource.ts"
import { mirrorFile, readMirror } from "../../src/jira/mirror.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk } from "../fs/helpers.ts"
import { eventually, liveTest, takeWithin } from "../hub/helpers.ts"
import { adfText, anIssue } from "./fake.ts"
import { onDisk, withJira } from "./helpers.ts"

const decode = (fields: Record<string, unknown>) =>
  Effect.result(Schema.decodeUnknownEffect(JiraConfig)(fields))

const valid = { site: "https://acme.atlassian.net", email: "tester@acme.test" }

describe("the Jira config", () => {
  effectTest(
    "wants exactly one of token_env and token_command",
    Effect.gen(function* () {
      expect((yield* decode({ ...valid, token_env: "JIRA_TOKEN" }))._tag).toBe("Success")
      expect((yield* decode({ ...valid, token_command: "echo t" }))._tag).toBe("Success")
      expect((yield* decode(valid))._tag).toBe("Failure")
      expect(
        (yield* decode({ ...valid, token_env: "JIRA_TOKEN", token_command: "echo t" }))._tag,
      ).toBe("Failure")
    }),
  )

  effectTest(
    "wants a site and an email",
    Effect.gen(function* () {
      expect((yield* decode({ email: "a@b.test", token_env: "T" }))._tag).toBe("Failure")
      expect((yield* decode({ site: "https://a.test", token_env: "T" }))._tag).toBe("Failure")
      expect((yield* decode({ ...valid, site: "  ", token_env: "T" }))._tag).toBe("Failure")
    }),
  )
})

describe("the Jira queries", () => {
  effectTest(
    "defaults to my unfinished and recently finished issues",
    Effect.sync(() => {
      const queries = queriesOf({ ...valid, token_env: "T" })
      expect(queries.open).toBe(
        "assignee = currentUser() AND statusCategory != Done ORDER BY Rank ASC",
      )
      expect(queries.done).toBe(
        "assignee = currentUser() AND statusCategory = Done AND resolved >= -30d ORDER BY resolved DESC",
      )
    }),
  )

  effectTest(
    "appends an order only when the query has none",
    Effect.sync(() => {
      expect(orderedBy("project = PROJ", "Rank ASC")).toBe("project = PROJ ORDER BY Rank ASC")
      expect(orderedBy("project = PROJ order by created", "Rank ASC")).toBe(
        "project = PROJ order by created",
      )
    }),
  )

  effectTest(
    "uses the configured queries",
    Effect.sync(() => {
      const queries = queriesOf({
        ...valid,
        token_env: "T",
        jql: "project = PROJ",
        done_jql: "project = PROJ AND statusCategory = Done",
      })

      expect(queries.open).toBe("project = PROJ ORDER BY Rank ASC")
      expect(queries.done).toBe("project = PROJ AND statusCategory = Done ORDER BY resolved DESC")
    }),
  )
})

describe("the Jira source: location and capabilities", () => {
  effectTest(
    "shows the site as the project's location, and can sync",
    withJira(({ source, config }) =>
      Effect.sync(() => {
        expect(source.kind).toBe("jira")
        expect(source.location(config)).toBe("https://acme.atlassian.net")
        expect(source.sync).toBeDefined()
        expect(source.defaultName).toBeUndefined()
      }),
    ),
    onDisk(),
  )
})

describe("the Jira source: sync", () => {
  effectTest(
    "writes both queries into the mirror and counts them",
    withJira(({ jira, source, dir, project }) =>
      Effect.gen(function* () {
        jira.put(
          anIssue("PROJ-1", { summary: "Open one", description: adfText("Do it.") }),
          anIssue("PROJ-2", { summary: "Open two" }),
          anIssue("PROJ-3", { summary: "Closed" }, { done: true }),
        )
        const outcome = yield* source.sync?.(project) ?? Effect.die("no sync")
        expect(outcome.summary).toBe("2 open, 1 done")
        const mirror = Option.getOrThrow(yield* readMirror(dir))
        expect(mirror.open.map((task) => task.id)).toEqual(["PROJ-1", "PROJ-2"])
        expect(mirror.open[0]?.description).toBe("Do it.")
        expect(mirror.done.map((task) => task.id)).toEqual(["PROJ-3"])
        expect(mirror.done[0]?.status).toBe("done")
      }),
    ),
    onDisk(),
  )

  effectTest(
    "follows every page of each query",
    withJira(
      ({ jira, source, dir, project }) =>
        Effect.gen(function* () {
          jira.put(...[1, 2, 3, 4, 5].map((n) => anIssue(`PROJ-${n}`)))
          yield* source.sync?.(project) ?? Effect.die("no sync")
          const mirror = Option.getOrThrow(yield* readMirror(dir))
          expect(mirror.open).toHaveLength(5)
        }),
      { fake: { pageSize: 2 } },
    ),
    onDisk(),
  )

  effectTest(
    "sends each query with its order",
    withJira(({ jira, source, project }) =>
      Effect.gen(function* () {
        yield* source.sync?.(project) ?? Effect.die("no sync")
        expect(jira.searches).toEqual([
          "assignee = currentUser() AND statusCategory != Done ORDER BY Rank ASC",
          "assignee = currentUser() AND statusCategory = Done AND resolved >= -30d ORDER BY resolved DESC",
        ])
      }),
    ),
    onDisk(),
  )

  const failsWith = (
    failure: "auth" | "rateLimited" | "network" | "serverError",
    reason: SyncError["reason"],
    part?: string,
  ) =>
    effectTest(
      `reports ${failure} as ${reason}`,
      withJira(({ jira, source, project }) =>
        Effect.gen(function* () {
          jira.fail(failure)
          const error = yield* Effect.flip(source.sync?.(project) ?? Effect.die("no sync"))
          expect(error._tag).toBe("SyncError")
          expect(error.reason).toBe(reason)
          expect(error.project).toBe("work")

          if (part !== undefined) expect(error.message).toContain(part)
        }),
      ),
      onDisk(),
    )

  failsWith("auth", "auth")
  failsWith("network", "offline")
  failsWith("rateLimited", "remote", "42")
  failsWith("serverError", "remote", "Jira is having a moment")

  effectTest(
    "leaves the last good mirror in place when a sync fails",
    withJira(({ jira, source, dir, project }) =>
      Effect.gen(function* () {
        jira.put(anIssue("PROJ-1"))
        yield* source.sync?.(project) ?? Effect.die("no sync")
        jira.fail("serverError")
        yield* Effect.flip(source.sync?.(project) ?? Effect.die("no sync"))
        const mirror = Option.getOrThrow(yield* readMirror(dir))
        expect(mirror.open.map((task) => task.id)).toEqual(["PROJ-1"])
      }),
    ),
    onDisk(),
  )
})

describe("the Jira source: prepare", () => {
  effectTest(
    "checks the credentials and mirrors the issues",
    withJira(({ jira, source, dir, project }) =>
      Effect.gen(function* () {
        jira.put(anIssue("PROJ-1"))
        yield* source.prepare?.(project) ?? Effect.die("no prepare")
        expect(jira.requests[0]?.url).toContain("/myself")
        expect(Option.isSome(yield* readMirror(dir))).toBe(true)
      }),
    ),
    onDisk(),
  )

  effectTest(
    "refuses credentials Jira rejects, and writes no mirror",
    withJira(({ jira, source, project }) =>
      Effect.gen(function* () {
        jira.fail("auth")
        const error = yield* Effect.flip(source.prepare?.(project) ?? Effect.die("no prepare"))
        expect(error._tag).toBe("SourceError")
        expect(error.message).toContain("credentials")
        expect(yield* (yield* Disk).exists(`projects/work/${mirrorFile}`)).toBe(false)
      }),
    ),
    onDisk(),
  )
})

describe("the Jira source: changes", () => {
  liveTest(
    "emits when the mirror changes, and not when the hub writes its own state",
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<void>()
      yield* withJira(({ jira, source, dir, project }) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          yield* fs.makeDirectory(dir, { recursive: true })
          yield* Stream.runForEach(source.changes?.(project) ?? Stream.empty, () =>
            Queue.offer(events, undefined),
          ).pipe(Effect.forkScoped)

          // A watch starts asynchronously, so the first change is repeated
          // until it lands rather than slept on.
          const armed = yield* eventually(
            fs.writeFileString(`${dir}/${mirrorFile}`, "{}").pipe(Effect.orDie),
            takeWithin(events, "200 millis"),
          )

          expect(Option.isSome(armed)).toBe(true)
          let settling = true

          while (settling) {
            settling = Option.isSome(yield* takeWithin(events, "300 millis"))
          }

          // The hub's own file, next to ours: not a change to the list.
          yield* fs.writeFileString(`${dir}/state.json`, "{}").pipe(Effect.orDie)
          expect(Option.isNone(yield* takeWithin(events, "500 millis"))).toBe(true)

          jira.put(anIssue("PROJ-1"))
          yield* source.sync?.(project) ?? Effect.die("no sync")
          expect(Option.isSome(yield* takeWithin(events, "5 seconds"))).toBe(true)
        }),
      )
    }),
    onDisk(),
  )
})
