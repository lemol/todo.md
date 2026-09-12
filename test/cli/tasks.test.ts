import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, diskWith, md } from "../fs/helpers.ts"
import { acme, lines } from "./fixtures.ts"
import { runTodo, todo } from "./harness.ts"

const showJson = (id: string) =>
  Effect.map(todo("show", id, "--json"), (result) => JSON.parse(result.stdout).view.task)

describe("todo add", () => {
  effectTest(
    "adds a task with the next free ID, joining unquoted words",
    Effect.gen(function* () {
      const result = yield* todo("add", "Ship", "it", "--group", "Backend", "--tag", "release")
      expect(result).toEqual({ code: 0, stdout: "Added 06  Ship it to Backend", stderr: "" })
      expect(yield* (yield* Disk).read("TODO.md")).toContain("- [ ] 06 - Ship it\n  #release\n")
    }),
    diskWith(acme),
  )

  effectTest(
    "accepts padded IDs for dependencies and anchors, and prints JSON",
    Effect.gen(function* () {
      const result = yield* todo(
        "add",
        "Load test",
        "--depends-on",
        "02",
        "--before",
        "03",
        "--json",
      )
      expect(JSON.parse(result.stdout)).toMatchObject({
        id: "6",
        title: "Load test",
        dependsOn: ["2"],
        group: "Backend",
      })
      expect((yield* todo("ls", "--group", "Backend")).stdout).toContain(
        lines("  02  Add rate limiting   #api", "  06  Load test"),
      )
    }),
    diskWith(acme),
  )

  effectTest(
    "fails for an unknown anchor",
    Effect.gen(function* () {
      expect(yield* todo("add", "X", "--after", "99")).toEqual({
        code: 1,
        stdout: "",
        stderr: "error: no task 99",
      })
    }),
    diskWith(acme),
  )
})

describe("todo edit", () => {
  effectTest(
    "changes the title, tags, assignee and dependencies",
    Effect.gen(function* () {
      const result = yield* todo(
        "edit",
        "03",
        "--title",
        "Fix the redirect",
        "--tag",
        "urgent",
        "--untag",
        "bug",
        "--unassign",
        "--drop-dependency",
        "2",
      )
      expect(result.stdout).toBe("Updated 03  Fix the redirect")
      expect(yield* showJson("3")).toMatchObject({
        title: "Fix the redirect",
        tags: ["urgent"],
        dependsOn: [],
      })
      expect((yield* showJson("3")).assignee).toBeUndefined()
    }),
    diskWith(acme),
  )

  effectTest(
    "refuses an empty or contradictory edit with a usage error",
    Effect.gen(function* () {
      const empty = yield* todo("edit", "3")
      expect(empty.code).toBe(2)
      expect(empty.stderr).toBe(
        "error: nothing to change; pass --title, --tag, --assignee or another change",
      )
      expect((yield* todo("edit", "3", "--assignee", "a", "--unassign")).code).toBe(2)
    }),
    diskWith(acme),
  )
})

describe("todo done and reopen", () => {
  effectTest(
    "completes tasks and lists the ones that became ready",
    Effect.gen(function* () {
      expect((yield* todo("done", "2")).stdout).toBe(
        lines("Done 02  Add rate limiting", "Now ready:", "  03  Fix login redirect  #bug @lemol"),
      )
      expect(yield* (yield* Disk).exists("done/backend/02-add-rate-limiting.md")).toBe(true)
      const both = JSON.parse((yield* todo("done", "1", "4", "--json")).stdout)
      expect(both.map((c: { task: { id: string } }) => c.task.id)).toEqual(["1", "4"])
    }),
    diskWith(acme),
  )

  effectTest(
    "explains why a task cannot be completed or reopened",
    Effect.gen(function* () {
      expect((yield* todo("done", "99")).stderr).toBe("error: no task 99")
      yield* todo("done", "2")
      expect((yield* todo("done", "2")).stderr).toBe(
        "error: task 2 is done, so it cannot be completed",
      )
      expect((yield* todo("reopen", "2")).stdout).toBe("Reopened 02  Add rate limiting")
      expect((yield* todo("reopen", "2")).stderr).toBe(
        "error: task 2 is open, so it cannot be reopened",
      )
    }),
    diskWith(acme),
  )
})

describe("todo mv", () => {
  effectTest(
    "moves a task to the top, to another group, or out of its group",
    Effect.gen(function* () {
      expect((yield* todo("mv", "3", "--top")).stdout).toBe(
        "Moved 03  Fix login redirect to Backend",
      )
      expect((yield* todo("ls", "--group", "Backend")).stdout).toContain(
        lines(
          "  03  Fix login redirect  #bug @lemol",
          "      blocked by 02",
          "  02  Add rate limiting   #api",
        ),
      )
      expect((yield* todo("mv", "1", "--group", "Frontend")).stdout).toBe(
        "Moved 01  Write changelog to Frontend",
      )
      expect((yield* todo("mv", "4", "--ungrouped")).stdout).toBe(
        "Moved 04  Fix layout to the ungrouped tasks",
      )
      expect((yield* todo("mv", "3", "--bottom")).code).toBe(0)
      expect((yield* todo("mv", "2", "--after", "3", "--json")).code).toBe(0)
    }),
    diskWith(acme),
  )

  effectTest(
    "needs exactly one destination",
    Effect.gen(function* () {
      const none = yield* todo("mv", "3")
      expect(none.code).toBe(2)
      expect(none.stderr).toContain("say where to move it")
      expect((yield* todo("mv", "3", "--top", "--bottom")).code).toBe(2)
    }),
    diskWith(acme),
  )
})

describe("todo rm", () => {
  effectTest(
    "refuses to remove a task others depend on unless forced",
    Effect.gen(function* () {
      expect(yield* todo("rm", "2")).toEqual({
        code: 1,
        stdout: "",
        stderr: "error: task 2 is needed by 3; use --force to remove it anyway",
      })
      expect((yield* todo("rm", "2", "--force")).stdout).toBe("Removed 02")
      expect(yield* (yield* Disk).exists("backend/02-add-rate-limiting.md")).toBe(false)
      expect(JSON.parse((yield* todo("rm", "1", "--json")).stdout)).toEqual({ removed: "1" })
    }),
    diskWith(acme),
  )
})

describe("todo comment", () => {
  effectTest(
    "adds a comment, moving an inline task into its own file",
    Effect.gen(function* () {
      const result = yield* todo("comment", "1", "Draft", "it", "--author", "claude")
      expect(result).toEqual({ code: 0, stdout: "Commented on 01", stderr: "" })
      expect(yield* (yield* Disk).read("01-write-changelog.md")).toBe(
        md(
          "---",
          "title: Write changelog",
          "---",
          "## Comments",
          "",
          "### @claude at 1970-01-01 00:00 +00:00",
          "",
          "Draft it",
        ),
      )
    }),
    diskWith(acme),
  )

  effectTest(
    "takes the author from $TODO_MD_AUTHOR, then the user name",
    Effect.gen(function* () {
      yield* runTodo(["comment", "2", "From", "env"], { env: { TODO_MD_AUTHOR: "agent-7" } })
      yield* todo("comment", "2", "From", "user")
      const comments = (yield* showJson("2")).comments.map((c: { author: string }) => c.author)
      expect(comments).toEqual(["tester", "agent-7", "lemol"])
    }),
    diskWith(acme),
  )
})
