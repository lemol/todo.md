import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { TodoStore } from "../../src/spec/index.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, listWith, md } from "./helpers.ts"

const todo = md(
  "# Acme API",
  "",
  "Backlog.",
  "",
  "- [ ] 01 - Write changelog",
  "",
  "## Backend",
  "",
  "Server-side work.",
  "",
  "- [ ] [02 - Add rate limiting](./backend/02-add-rate-limiting.md)",
  "- [ ] 03 - Fix login redirect",
  "  #bug @lemol",
  "  Users land on /home.",
)

const rateLimiting = md(
  "---",
  "title: Add rate limiting   # from the review",
  "tags: [api]",
  "---",
  "Token bucket per API key.",
)

const list = () => listWith({ "TODO.md": todo, "backend/02-add-rate-limiting.md": rateLimiting })

describe("FsTodoStore promotes tasks", () => {
  effectTest(
    "promote writes the task file and links the item, leaving the rest byte-for-byte",
    Effect.gen(function* () {
      const disk = yield* Disk
      yield* (yield* TodoStore).promote("3")
      expect(yield* disk.read("backend/03-fix-login-redirect.md")).toBe(
        md(
          "---",
          "title: Fix login redirect",
          "tags: [bug]",
          "assignee: lemol",
          "---",
          "Users land on /home.",
        ),
      )
      expect(yield* disk.read("TODO.md")).toBe(
        todo.replace(
          md("- [ ] 03 - Fix login redirect", "  #bug @lemol", "  Users land on /home."),
          md("- [ ] [03 - Fix login redirect](./backend/03-fix-login-redirect.md)"),
        ),
      )
    }),
    list(),
  )

  effectTest(
    "promote puts an ungrouped task's file in the tasks directory itself",
    Effect.gen(function* () {
      const disk = yield* Disk
      yield* (yield* TodoStore).promote("1")
      expect(yield* disk.exists("01-write-changelog.md")).toBe(true)
      expect(yield* disk.read("TODO.md")).toContain(
        "- [ ] [01 - Write changelog](./01-write-changelog.md)",
      )
    }),
    list(),
  )

  effectTest(
    "promote leaves an already file-backed task alone, hand-written comments included",
    Effect.gen(function* () {
      const disk = yield* Disk
      yield* (yield* TodoStore).promote("2")
      expect(yield* disk.read("backend/02-add-rate-limiting.md")).toBe(rateLimiting)
      expect(yield* disk.read("TODO.md")).toBe(todo)
    }),
    list(),
  )

  effectTest(
    "promote leaves a done task's file where completion put it",
    Effect.gen(function* () {
      const disk = yield* Disk
      const store = yield* TodoStore
      yield* store.complete("1")
      const before = yield* disk.tree()
      yield* store.promote("1")
      expect(yield* disk.tree()).toEqual(before)
    }),
    list(),
  )
})
