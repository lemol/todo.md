import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { TodoStore } from "../../src/spec/index.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { adfText, anIssue, type RawIssue } from "./fake.ts"
import { type FixtureOptions, type JiraFixture, onDisk, withJira } from "./helpers.ts"

/** Seeds the fake, syncs, opens the store and hands it to `use`. */
const opened = <A, E>(
  issues: ReadonlyArray<RawIssue>,
  use: (store: TodoStore["Service"], fixture: JiraFixture) => Effect.Effect<A, E>,
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
    "declares no optional capability while it is read-only",
    opened([], (store) =>
      Effect.sync(() => {
        expect(Object.values(store.capabilities).every((allowed) => !allowed)).toBe(true)
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

describe("the Jira store: writing", () => {
  const refuses = (
    name: string,
    call: (store: TodoStore["Service"]) => Effect.Effect<unknown, { readonly _tag: string }>,
    tag: string,
  ) =>
    effectTest(
      `refuses ${name} with ${tag}`,
      opened([anIssue("PROJ-1")], (store) =>
        Effect.gen(function* () {
          expect((yield* Effect.flip(call(store)))._tag).toBe(tag)
        }),
      ),
      onDisk(),
    )

  refuses("add", (store) => store.add({ title: "New" }), "Unsupported")
  refuses("remove", (store) => store.remove("PROJ-1"), "Unsupported")
  refuses("move", (store) => store.move("PROJ-1", { group: "Later" }), "Unsupported")
  refuses("renameGroup", (store) => store.renameGroup("a", "b"), "Unsupported")
  refuses("promote", (store) => store.promote("PROJ-1"), "Unsupported")
  refuses("cancel", (store) => store.cancel("PROJ-1", "no"), "Unsupported")
  refuses(
    "comment",
    (store) => store.comment("PROJ-1", { author: "me", body: "hi" }),
    "Unsupported",
  )

  // Until the mutations land, the always-required operations say so rather
  // than pretending to have reached Jira.
  refuses("complete", (store) => store.complete("PROJ-1"), "StoreError")
  refuses("reopen", (store) => store.reopen("PROJ-1"), "StoreError")
  refuses("update", (store) => store.update("PROJ-1", { title: "New" }), "StoreError")
})
