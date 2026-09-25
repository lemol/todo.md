import { describe, expect } from "bun:test"
import { Effect, Option } from "effect"
import type { SourceEnv } from "../../src/hub/index.ts"
import { readMirror } from "../../src/jira/mirror.ts"
import { TodoStore } from "../../src/spec/index.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { adfText, anIssue, type RawIssue, statuses } from "./fake.ts"
import { type FixtureOptions, type JiraFixture, onDisk, withJira } from "./helpers.ts"

/** Seeds the fake, syncs, opens the store and hands it to `use`. */
const opened = <A, E>(
  issues: ReadonlyArray<RawIssue>,
  use: (store: TodoStore["Service"], fixture: JiraFixture) => Effect.Effect<A, E, SourceEnv>,
  options: FixtureOptions = {},
) =>
  withJira(
    (fixture) =>
      Effect.gen(function* () {
        fixture.jira.put(...issues)
        yield* fixture.source.sync?.(fixture.project) ?? Effect.die("this source cannot sync")
        return yield* Effect.flatMap(TodoStore, (store) => use(store, fixture)).pipe(
          Effect.provide(fixture.source.open(fixture.project)),
        )
      }),
    options,
  )

describe("the Jira store: reading", () => {
  effectTest(
    "lists the mirror's open issues as the project's tasks",
    opened(
      [
        anIssue("PROJ-1", { summary: "Open one", description: adfText("Do it.") }),
        anIssue("PROJ-2", { summary: "Closed" }, { done: true }),
      ],
      (store) =>
        Effect.gen(function* () {
          const list = yield* store.load()
          expect(list.title).toBe("work")
          expect(list.description).toBe("")
          expect(list.groups).toEqual([])
          expect(list.ungrouped.map((task) => task.id)).toEqual(["PROJ-1"])
          expect(list.ungrouped[0]?.description).toBe("Do it.")
          expect((yield* store.listDone()).map((task) => task.id)).toEqual(["PROJ-2"])
        }),
    ),
    onDisk(),
  )

  effectTest(
    "asks for a sync when the project has never been synced",
    withJira(({ source, project }) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          Effect.provide(
            Effect.gen(function* () {
              yield* TodoStore
            }),
            source.open(project),
          ),
        )
        expect(error._tag).toBe("SourceError")
        expect(error.message).toContain("todo sync work")
      }),
    ),
    onDisk(),
  )

  effectTest(
    "reads a task from the mirror without asking Jira",
    opened([anIssue("PROJ-1", { summary: "From the mirror" })], (store, { jira }) =>
      Effect.gen(function* () {
        const before = jira.requests.length
        expect((yield* store.get("PROJ-1")).title).toBe("From the mirror")
        expect(jira.requests.length).toBe(before)
      }),
    ),
    onDisk(),
  )

  effectTest(
    "declares comments and nothing else optional",
    opened([], (store) =>
      Effect.sync(() => {
        const allowed = Object.entries(store.capabilities).filter(([, on]) => on)
        expect(allowed.map(([name]) => name)).toEqual(["comments"])
      }),
    ),
    onDisk(),
  )

  effectTest(
    "reports no diagnostics",
    opened([], (store) =>
      Effect.gen(function* () {
        expect(yield* store.diagnostics()).toEqual([])
      }),
    ),
    onDisk(),
  )
})

describe("the Jira store: get", () => {
  effectTest(
    "fetches an issue the mirror does not have, and leaves the mirror alone",
    opened([anIssue("PROJ-1")], (store, { jira }) =>
      Effect.gen(function* () {
        jira.put(anIssue("PROJ-77", { summary: "Filed later" }))
        expect((yield* store.get("PROJ-77")).title).toBe("Filed later")
        expect((yield* store.load()).ungrouped.map((task) => task.id)).toEqual(["PROJ-1"])
      }),
    ),
    onDisk(),
  )

  effectTest(
    "reports an unknown key as a missing task",
    opened([], (store) =>
      Effect.gen(function* () {
        expect((yield* Effect.flip(store.get("PROJ-404")))._tag).toBe("TaskNotFound")
      }),
    ),
    onDisk(),
  )

  const comment = (id: string, day: string) => ({
    id,
    author: { accountId: "a", displayName: "Ana Silva" },
    created: `2026-01-0${day}T09:00:00.000+0000`,
    body: adfText(`Note ${id}`),
  })

  effectTest(
    "fetches the rest of a truncated comment page",
    opened(
      [anIssue("PROJ-5", { comment: [comment("1", "1"), comment("2", "2"), comment("3", "3")] })],
      (store) =>
        Effect.gen(function* () {
          const task = yield* store.get("PROJ-5")
          expect(task.comments.map((one) => one.body)).toEqual(["Note 3", "Note 2", "Note 1"])
        }),
      { fake: { commentPageSize: 1 } },
    ),
    onDisk(),
  )
})

describe("the Jira store: what it cannot do", () => {
  const refuses = (
    name: string,
    call: (store: TodoStore["Service"]) => Effect.Effect<unknown, { readonly _tag: string }>,
  ) =>
    effectTest(
      `refuses ${name} with Unsupported`,
      opened([anIssue("PROJ-1")], (store) =>
        Effect.gen(function* () {
          expect((yield* Effect.flip(call(store)))._tag).toBe("Unsupported")
        }),
      ),
      onDisk(),
    )

  refuses("add", (store) => store.add({ title: "New" }))
  refuses("remove", (store) => store.remove("PROJ-1"))
  refuses("move", (store) => store.move("PROJ-1", { group: "Later" }))
  refuses("renameGroup", (store) => store.renameGroup("a", "b"))
  refuses("promote", (store) => store.promote("PROJ-1"))
  refuses("cancel", (store) => store.cancel("PROJ-1", "no"))
})

/** The mirror's open and done keys, as the store left them. */
const sides = (dir: string) =>
  Effect.map(readMirror(dir), (mirror) => {
    const current = Option.getOrThrow(mirror)
    return {
      open: current.open.map((task) => task.id),
      done: current.done.map((task) => task.id),
    }
  })

const writes = (jira: JiraFixture["jira"]) =>
  jira.requests.filter((request) => request.method !== "GET")

describe("the Jira store: complete and reopen", () => {
  effectTest(
    "completes through the first transition into the done category, and moves it in the mirror",
    opened([anIssue("PROJ-1"), anIssue("PROJ-2")], (store, { jira, dir }) =>
      Effect.gen(function* () {
        const done = yield* store.complete("PROJ-1")
        expect(done.status).toBe("done")
        expect(done.outcome).toBe("completed")
        expect(done.completedAt).toBeDefined()
        expect(writes(jira).map((request) => request.body)).toEqual([{ transition: { id: "31" } }])
        expect(yield* sides(dir)).toEqual({ open: ["PROJ-2"], done: ["PROJ-1"] })
        expect((yield* store.get("PROJ-1")).status).toBe("done")
      }),
    ),
    onDisk(),
  )

  effectTest(
    "uses the transition done_transition names, whatever its category",
    opened(
      [anIssue("PROJ-1")],
      (store, { jira }) =>
        Effect.gen(function* () {
          jira.workflow("To Do", [
            { id: "5", name: "Close", to: statuses.done },
            { id: "6", name: "Ship it", to: statuses.done },
          ])
          yield* store.complete("PROJ-1")
          expect(writes(jira).map((request) => request.body)).toEqual([{ transition: { id: "6" } }])
        }),
      { config: { done_transition: "ship IT" } },
    ),
    onDisk(),
  )

  effectTest(
    "names the available transitions when none leads to done",
    opened([anIssue("PROJ-1")], (store, { jira, dir }) =>
      Effect.gen(function* () {
        jira.workflow("To Do", [{ id: "21", name: "Start", to: statuses.inProgress }])
        const error = yield* Effect.flip(store.complete("PROJ-1"))
        expect(error._tag).toBe("StoreError")
        expect(error.message).toContain("available: Start")
        expect(error.message).toContain("done_transition")
        expect(writes(jira)).toEqual([])
        expect(yield* sides(dir)).toEqual({ open: ["PROJ-1"], done: [] })
      }),
    ),
    onDisk(),
  )

  effectTest(
    "names the available transitions when the configured one is not offered",
    opened(
      [anIssue("PROJ-1")],
      (store) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(store.complete("PROJ-1"))
          expect(error.message).toContain("no transition is named Ship it")
          expect(error.message).toContain("available: Start, Done")
        }),
      { config: { done_transition: "Ship it" } },
    ),
    onDisk(),
  )

  effectTest(
    "refuses to complete a done issue without asking Jira",
    opened([anIssue("PROJ-1", {}, { done: true })], (store, { jira }) =>
      Effect.gen(function* () {
        expect((yield* Effect.flip(store.complete("PROJ-1")))._tag).toBe("InvalidTransition")
        expect(writes(jira)).toEqual([])
      }),
    ),
    onDisk(),
  )

  effectTest(
    "reopens through the first transition into the to-do category, or reopen_transition",
    opened(
      [anIssue("PROJ-1", {}, { done: true }), anIssue("PROJ-2", {}, { done: true })],
      (store, { jira, dir }) =>
        Effect.gen(function* () {
          const reopened = yield* store.reopen("PROJ-1")
          expect(reopened.status).toBe("open")
          expect(reopened.completedAt).toBeUndefined()
          expect(yield* sides(dir)).toEqual({ open: ["PROJ-1"], done: ["PROJ-2"] })
          jira.workflow("Done", [
            { id: "41", name: "Reopen", to: statuses.toDo },
            { id: "42", name: "Back to work", to: statuses.inProgress },
          ])
          expect((yield* Effect.flip(store.reopen("PROJ-1")))._tag).toBe("InvalidTransition")
          expect(writes(jira).map((request) => request.body)).toEqual([
            { transition: { id: "41" } },
          ])
        }),
    ),
    onDisk(),
  )

  effectTest(
    "reopens through reopen_transition when it is set",
    opened(
      [anIssue("PROJ-1", {}, { done: true })],
      (store, { jira }) =>
        Effect.gen(function* () {
          jira.workflow("Done", [
            { id: "41", name: "Reopen", to: statuses.toDo },
            { id: "42", name: "Back to work", to: statuses.inProgress },
          ])
          expect((yield* store.reopen("PROJ-1")).extra.status).toBe("In Progress")
          expect(writes(jira).map((request) => request.body)).toEqual([
            { transition: { id: "42" } },
          ])
        }),
      { config: { reopen_transition: "Back to work" } },
    ),
    onDisk(),
  )

  effectTest(
    "reports an issue gone from Jira as a missing task",
    opened([anIssue("PROJ-1")], (store, { jira }) =>
      Effect.gen(function* () {
        jira.remove("PROJ-1")
        expect((yield* Effect.flip(store.complete("PROJ-1")))._tag).toBe("TaskNotFound")
      }),
    ),
    onDisk(),
  )
})

describe("the Jira store: update", () => {
  effectTest(
    "sends the title as the summary and the tags as labels, and patches the mirror",
    opened([anIssue("PROJ-1", { labels: ["old"] })], (store, { jira, dir }) =>
      Effect.gen(function* () {
        const updated = yield* store.update("PROJ-1", { title: "Renamed", tags: ["a", "b", "a"] })
        expect(updated.title).toBe("Renamed")
        expect(updated.tags).toEqual(["a", "b"])
        expect(writes(jira).map((request) => [request.method, request.body])).toEqual([
          ["PUT", { fields: { summary: "Renamed", labels: ["a", "b"] } }],
        ])
        const mirror = Option.getOrThrow(yield* readMirror(dir))
        expect(mirror.open.map((task) => task.title)).toEqual(["Renamed"])
      }),
    ),
    onDisk(),
  )

  for (const [field, patch] of [
    ["description", { description: "More." }],
    ["assignee", { assignee: null }],
    ["dependsOn", { dependsOn: ["PROJ-2"] }],
    ["extra", { extra: { estimate: 3 } }],
  ] as const) {
    effectTest(
      `refuses ${field} as read-only and sends nothing`,
      opened([anIssue("PROJ-1"), anIssue("PROJ-2")], (store, { jira }) =>
        Effect.gen(function* () {
          const before = jira.requests.length
          const error = yield* Effect.flip(store.update("PROJ-1", { title: "New", ...patch }))
          expect(error._tag).toBe("ValidationError")
          expect(error._tag === "ValidationError" ? error.issues : []).toEqual([
            `${field} is read-only for Jira projects`,
          ])
          expect(jira.requests.length).toBe(before)
        }),
      ),
      onDisk(),
    )
  }
})

describe("the Jira store: comment", () => {
  effectTest(
    "sends the body as ADF paragraphs split on blank lines, signed by the Jira user",
    opened([anIssue("PROJ-1")], (store, { jira, dir }) =>
      Effect.gen(function* () {
        const comment = yield* store.comment("PROJ-1", {
          author: "someone-else",
          body: "First line\nsecond line\n\n  \nSecond paragraph.",
        })
        expect(comment.author).toBe("test-user")
        expect(writes(jira).map((request) => request.body)).toEqual([
          {
            body: {
              type: "doc",
              version: 1,
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "First line" },
                    { type: "hardBreak" },
                    { type: "text", text: "second line" },
                  ],
                },
                { type: "paragraph", content: [{ type: "text", text: "Second paragraph." }] },
              ],
            },
          },
        ])
        const mirror = Option.getOrThrow(yield* readMirror(dir))
        expect(mirror.open[0]?.comments.map((one) => one.author)).toEqual(["test-user"])
      }),
    ),
    onDisk(),
  )

  effectTest(
    "still refuses an invalid author, sending nothing",
    opened([anIssue("PROJ-1")], (store, { jira }) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          store.comment("PROJ-1", { author: "two words", body: "Hi." }),
        )
        expect(error._tag).toBe("ValidationError")
        expect(writes(jira)).toEqual([])
      }),
    ),
    onDisk(),
  )
})

describe("the Jira store: read-only", () => {
  const readOnly = { config: { read_only: true } }

  effectTest(
    "declares no optional capability, not even comments",
    opened(
      [],
      (store) =>
        Effect.sync(() => {
          expect(Object.values(store.capabilities).every((allowed) => !allowed)).toBe(true)
        }),
      readOnly,
    ),
    onDisk(),
  )

  effectTest(
    "refuses every mutation with the setting's name, and sends nothing",
    opened(
      [anIssue("PROJ-1"), anIssue("PROJ-2", {}, { done: true })],
      (store, { jira, dir }) =>
        Effect.gen(function* () {
          const before = jira.requests.length
          const calls: ReadonlyArray<
            Effect.Effect<unknown, { readonly _tag: string; readonly message?: string }>
          > = [
            store.complete("PROJ-1"),
            store.reopen("PROJ-2"),
            store.update("PROJ-1", { title: "Renamed" }),
          ]
          for (const call of calls) {
            const error = yield* Effect.flip(call)
            expect(error._tag).toBe("StoreError")
            expect(error.message).toContain("work is read-only (read_only")
          }
          const comment = yield* Effect.flip(store.comment("PROJ-1", { author: "me", body: "Hi." }))
          expect(comment._tag).toBe("Unsupported")
          expect(jira.requests.length).toBe(before)
          expect(yield* sides(dir)).toEqual({ open: ["PROJ-1"], done: ["PROJ-2"] })
        }),
      readOnly,
    ),
    onDisk(),
  )

  effectTest(
    "still syncs Jira's own changes",
    opened(
      [anIssue("PROJ-1")],
      (store, { jira, source, project }) =>
        Effect.gen(function* () {
          jira.put(anIssue("PROJ-1", {}, { done: true }))
          yield* source.sync?.(project) ?? Effect.die("no sync")
          expect((yield* store.get("PROJ-1")).status).toBe("done")
        }),
      readOnly,
    ),
    onDisk(),
  )
})
