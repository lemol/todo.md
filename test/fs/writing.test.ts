import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
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

const at = (iso: string) => TestClock.setTime(Date.parse(iso))

describe("FsTodoStore writes the todo.md format", () => {
  effectTest(
    "add writes an inline item after the section's last task",
    Effect.gen(function* () {
      yield* (yield* TodoStore).add({ title: "Bump deps", tags: ["deps"] }, { group: "Backend" })
      expect(yield* (yield* Disk).read("TODO.md")).toBe(`${todo}- [ ] 04 - Bump deps\n  #deps\n`)
    }),
    list(),
  )

  effectTest(
    "add writes a task file when the task cannot be inline",
    Effect.gen(function* () {
      const disk = yield* Disk
      yield* (yield* TodoStore).add(
        { title: "Review auth", tags: ["needs review"] },
        { group: "Backend" },
      )
      expect(yield* disk.read("backend/04-review-auth.md")).toBe(
        md("---", "title: Review auth", "tags: [needs review]", "---"),
      )
      expect(yield* disk.read("TODO.md")).toBe(
        `${todo}- [ ] [04 - Review auth](./backend/04-review-auth.md)\n`,
      )
    }),
    list(),
  )

  effectTest(
    "add to a new group appends its heading",
    Effect.gen(function* () {
      yield* (yield* TodoStore).add({ title: "Ship it" }, { group: "Later" })
      expect(yield* (yield* Disk).read("TODO.md")).toBe(`${todo}\n## Later\n\n- [ ] 04 - Ship it\n`)
    }),
    list(),
  )

  effectTest(
    "complete writes an inline task to a done file and removes its item",
    Effect.gen(function* () {
      const disk = yield* Disk
      yield* at("2026-09-12T10:31:00Z")
      yield* (yield* TodoStore).complete("3")
      expect(yield* disk.read("done/backend/03-fix-login-redirect.md")).toBe(
        md(
          "---",
          "title: Fix login redirect",
          "tags: [bug]",
          "assignee: lemol",
          "group: Backend",
          "completed_at: 2026-09-12T10:31:00Z",
          "---",
          "Users land on /home.",
        ),
      )
      expect(yield* disk.read("TODO.md")).toBe(
        todo.replace("- [ ] 03 - Fix login redirect\n  #bug @lemol\n  Users land on /home.\n", ""),
      )
    }),
    list(),
  )

  effectTest(
    "complete moves a task file to the done directory, keeping its text",
    Effect.gen(function* () {
      const disk = yield* Disk
      yield* at("2026-09-12T10:31:00Z")
      yield* (yield* TodoStore).complete("2")
      expect(yield* disk.read("done/backend/02-add-rate-limiting.md")).toBe(
        rateLimiting.replace(
          "tags: [api]\n",
          "tags: [api]\ngroup: Backend\ncompleted_at: 2026-09-12T10:31:00Z\n",
        ),
      )
      expect(yield* disk.exists("backend/02-add-rate-limiting.md")).toBe(false)
    }),
    list(),
  )

  effectTest(
    "reopen restores the task file and appends a linked item",
    Effect.gen(function* () {
      const store = yield* TodoStore
      const disk = yield* Disk
      yield* store.complete("2")
      yield* store.reopen("2")
      expect(yield* disk.read("backend/02-add-rate-limiting.md")).toBe(rateLimiting)
      expect(yield* disk.read("TODO.md")).toBe(
        `${todo.replace("- [ ] [02 - Add rate limiting](./backend/02-add-rate-limiting.md)\n", "")}- [ ] [02 - Add rate limiting](./backend/02-add-rate-limiting.md)\n`,
      )
      expect(yield* disk.tree()).toEqual(["TODO.md", "backend/02-add-rate-limiting.md"])
    }),
    list(),
  )

  effectTest(
    "comment on an inline task moves it into a task file",
    Effect.gen(function* () {
      const disk = yield* Disk
      yield* at("2026-09-12T12:00:00Z")
      yield* (yield* TodoStore).comment("1", { author: "lemol", body: "Draft it." })
      expect(yield* disk.read("01-write-changelog.md")).toBe(
        md(
          "---",
          "title: Write changelog",
          "---",
          "## Comments",
          "",
          "### @lemol at 2026-09-12 12:00 +00:00",
          "",
          "Draft it.",
        ),
      )
      expect(yield* disk.read("TODO.md")).toBe(
        todo.replace(
          "- [ ] 01 - Write changelog",
          "- [ ] [01 - Write changelog](./01-write-changelog.md)",
        ),
      )
    }),
    list(),
  )

  effectTest(
    "move to another section moves the task file to that section's directory",
    Effect.gen(function* () {
      const disk = yield* Disk
      yield* (yield* TodoStore).move("2", {})
      expect(yield* disk.exists("backend/02-add-rate-limiting.md")).toBe(false)
      expect(yield* disk.read("02-add-rate-limiting.md")).toBe(rateLimiting)
      expect(yield* disk.read("TODO.md")).toBe(
        todo
          .replace("- [ ] [02 - Add rate limiting](./backend/02-add-rate-limiting.md)\n", "")
          .replace(
            "- [ ] 01 - Write changelog\n",
            "- [ ] 01 - Write changelog\n- [ ] [02 - Add rate limiting](./02-add-rate-limiting.md)\n",
          ),
      )
    }),
    list(),
  )

  effectTest(
    "renameGroup renames the heading and the group's directory",
    Effect.gen(function* () {
      const disk = yield* Disk
      yield* (yield* TodoStore).renameGroup("Backend", "Server")
      expect(yield* disk.tree()).toEqual(["TODO.md", "server/02-add-rate-limiting.md"])
      expect(yield* disk.read("TODO.md")).toBe(
        todo.replace("## Backend", "## Server").replace("./backend/02", "./server/02"),
      )
    }),
    list(),
  )

  effectTest(
    "update rewrites only the changed frontmatter and the link text",
    Effect.gen(function* () {
      const disk = yield* Disk
      yield* (yield* TodoStore).update("2", { title: "Add rate limits" })
      expect(yield* disk.read("backend/02-add-rate-limiting.md")).toBe(
        rateLimiting.replace(
          "title: Add rate limiting   # from the review",
          "title: Add rate limits",
        ),
      )
      expect(yield* disk.read("TODO.md")).toBe(
        todo.replace("[02 - Add rate limiting]", "[02 - Add rate limits]"),
      )
    }),
    list(),
  )

  effectTest(
    "remove deletes the item and its task file",
    Effect.gen(function* () {
      const disk = yield* Disk
      yield* (yield* TodoStore).remove("2")
      expect(yield* disk.tree()).toEqual(["TODO.md"])
      expect(yield* disk.read("TODO.md")).toBe(
        todo.replace("- [ ] [02 - Add rate limiting](./backend/02-add-rate-limiting.md)\n", ""),
      )
    }),
    list(),
  )
})
