import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { itemLinesFor } from "../../src/fs/writing.ts"
import { defaultConfig } from "../../src/markdown/index.ts"
import { type Task, TodoStore } from "../../src/spec/index.ts"
import { effectTest, failsWith } from "../../src/spec/testing.ts"
import { Disk, diskWith, filesOnDisk, listWith, md } from "./helpers.ts"

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
          "outcome: completed",
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
          "tags: [api]\ngroup: Backend\ncompleted_at: 2026-09-12T10:31:00Z\noutcome: completed\n",
        ),
      )
      expect(yield* disk.exists("backend/02-add-rate-limiting.md")).toBe(false)
    }),
    list(),
  )

  effectTest(
    "cancel writes an inline task to a done file with its outcome and reason, and removes its item",
    Effect.gen(function* () {
      const disk = yield* Disk
      yield* at("2026-09-12T10:31:00Z")
      yield* (yield* TodoStore).cancel("3", "Superseded by d47fcd2.")
      expect(yield* disk.read("done/backend/03-fix-login-redirect.md")).toBe(
        md(
          "---",
          "title: Fix login redirect",
          "tags: [bug]",
          "assignee: lemol",
          "group: Backend",
          "completed_at: 2026-09-12T10:31:00Z",
          "outcome: cancelled",
          "cancelled_reason: Superseded by d47fcd2.",
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

  effectTest(
    "comment refuses comment body with unescaped depth-2 or depth-3 headings",
    Effect.gen(function* () {
      const store = yield* TodoStore

      yield* failsWith(store.comment("1", { author: "lemol", body: "## ATX 2" }), "ValidationError")
      yield* failsWith(
        store.comment("1", { author: "lemol", body: "### ATX 3" }),
        "ValidationError",
      )
      yield* failsWith(
        store.comment("1", { author: "lemol", body: "Setext\n---" }),
        "ValidationError",
      )

      const valid = yield* store.comment("1", {
        author: "lemol",
        body: "#### Allowed 4\n```\n## In fence\n```",
      })

      expect(valid.body).toBe("#### Allowed 4\n```\n## In fence\n```")
    }),
    list(),
  )
})

describe("itemLinesFor", () => {
  const baseTask: Task = {
    id: "1",
    title: "Inline task",
    description: "",
    status: "open",
    tags: ["work"],
    dependsOn: [],
    comments: [],
    extra: {},
  }

  effectTest(
    "returns inline item lines without writing files when task fits inline",
    Effect.gen(function* () {
      const files = yield* filesOnDisk
      const disk = yield* Disk
      const lines = yield* itemLinesFor(files, defaultConfig, baseTask)
      expect(lines).toEqual(["- [ ] 01 - Inline task", "  #work"])
      expect(yield* disk.tree()).toEqual([])
    }),
    diskWith({}),
  )

  effectTest(
    "writes a task file and returns linked item lines when task cannot fit inline",
    Effect.gen(function* () {
      const files = yield* filesOnDisk
      const disk = yield* Disk
      const lines = yield* itemLinesFor(files, defaultConfig, {
        ...baseTask,
        id: "2",
        title: "Task with space in tag",
        tags: ["multi word"],
        group: "Backend",
      })

      expect(lines).toEqual([
        "- [ ] [02 - Task with space in tag](./backend/02-task-with-space-in-tag.md)",
      ])
      expect(yield* disk.tree()).toEqual(["backend/02-task-with-space-in-tag.md"])
      expect(yield* disk.read("backend/02-task-with-space-in-tag.md")).toContain(
        "tags: [multi word]",
      )
    }),
    diskWith({}),
  )

  effectTest(
    "writes to the given path when path is specified",
    Effect.gen(function* () {
      const files = yield* filesOnDisk
      const disk = yield* Disk
      const lines = yield* itemLinesFor(
        files,
        defaultConfig,
        {
          ...baseTask,
          id: "3",
          title: "Explicit path task",
          tags: [],
        },
        "custom/03-custom.md",
      )

      expect(lines).toEqual(["- [ ] [03 - Explicit path task](./custom/03-custom.md)"])
      expect(yield* disk.tree()).toEqual(["custom/03-custom.md"])
    }),
    diskWith({}),
  )
})
