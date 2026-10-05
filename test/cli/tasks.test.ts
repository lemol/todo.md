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
    "adds a task in its own file, joining unquoted words",
    Effect.gen(function* () {
      const result = yield* todo(
        "add",
        "Ship",
        "it",
        "--group",
        "Backend",
        "--no-description",
        "--tag",
        "release",
      )

      expect(result).toEqual({ code: 0, stdout: "Added 06  Ship it to Backend", stderr: "" })
      const disk = yield* Disk
      expect(yield* disk.read("TODO.md")).toContain(
        "- [ ] [06 - Ship it](./backend/06-ship-it.md)\n",
      )
      expect(yield* disk.read("backend/06-ship-it.md")).toBe(
        md("---", "title: Ship it", "tags: [release]", "---"),
      )
    }),
    diskWith(acme),
  )

  effectTest(
    "keeps it inline with --quick, and with --inline",
    Effect.gen(function* () {
      expect((yield* todo("add", "Write", "notes", "--quick")).stdout).toBe("Added 06  Write notes")
      const inline = yield* todo(
        "add",
        "Bump deps",
        "--group",
        "Backend",
        "--no-description",
        "--inline",
        "--tag",
        "ops",
      )

      expect(inline.code).toBe(0)
      const text = yield* (yield* Disk).read("TODO.md")
      expect(text).toContain("- [ ] 06 - Write notes\n")
      expect(text).toContain("- [ ] 07 - Bump deps\n  #ops\n")
    }),
    diskWith(acme),
  )

  effectTest(
    "lets an explicit flag override the part --quick would have decided",
    Effect.gen(function* () {
      expect((yield* todo("add", "Ship it", "--quick", "--group", "Backend")).stdout).toBe(
        "Added 06  Ship it to Backend",
      )
      expect(yield* (yield* Disk).read("TODO.md")).toContain("- [ ] 06 - Ship it\n")
      expect((yield* todo("add", "Log it", "--quick", "--file")).code).toBe(0)
      expect(yield* (yield* Disk).exists("07-log-it.md")).toBe(true)
    }),
    diskWith(acme),
  )

  effectTest(
    "makes you decide where it goes and what it is",
    Effect.gen(function* () {
      const placed = yield* todo("add", "Try it")
      expect(placed.code).toBe(2)
      expect(placed.stderr).toBe(
        "error: say where it goes: --group <name>, --no-group, --before or --after",
      )
      const described = yield* todo("add", "Try it", "--no-group")
      expect(described.code).toBe(2)
      expect(described.stderr).toContain("say what it is: --description <text>")

      for (const args of [
        ["--group", "Backend", "--no-group"],
        ["--no-group", "--description", "x", "--no-description"],
        ["--no-group", "--no-description", "--file", "--inline"],
      ]) {
        expect((yield* todo("add", "Try it", ...args)).code, args.join(" ")).toBe(2)
      }

      expect(yield* (yield* Disk).read("TODO.md")).toBe(acme["TODO.md"])
    }),
    diskWith(acme),
  )

  effectTest(
    "takes an anchor as the placement decision, and prints JSON",
    Effect.gen(function* () {
      const result = yield* runTodo(
        [
          "add",
          "Load test",
          "--depends-on",
          "02",
          "--before",
          "03",
          "--description",
          "-",
          "--json",
        ],
        { stdin: "Hammer it.\n" },
      )

      expect(JSON.parse(result.stdout)).toMatchObject({
        id: "6",
        title: "Load test",
        description: "Hammer it.\n",
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
      expect(yield* todo("add", "X", "--after", "99", "--no-description")).toEqual({
        code: 1,
        stdout: "",
        stderr: "error: no task 99",
      })
    }),
    diskWith(acme),
  )
})

describe("todo add --description -", () => {
  const body = "Run `git rev-parse HEAD` and $(date), \"quoted\" and 'single'.\n\n- A list\n"

  effectTest(
    "writes what was piped in byte for byte",
    Effect.gen(function* () {
      const result = yield* runTodo(
        ["add", "Record the cause", "--group", "Backend", "--description", "-"],
        { stdin: body },
      )

      expect(result).toEqual({
        code: 0,
        stdout: "Added 06  Record the cause to Backend",
        stderr: "",
      })
      expect(yield* (yield* Disk).read("backend/06-record-the-cause.md")).toBe(
        md("---", "title: Record the cause", "---", body.trimEnd()),
      )
    }),
    diskWith(acme),
  )

  effectTest(
    "says so when nothing was piped in, rather than writing an empty description",
    Effect.gen(function* () {
      const result = yield* todo("add", "Record it", "--no-group", "--description", "-")
      expect(result.code).toBe(2)
      expect(result.stderr).toBe(
        "error: --description - got nothing on stdin; pipe the text in, or use --no-description for none",
      )
      expect(yield* (yield* Disk).read("TODO.md")).toBe(acme["TODO.md"])
    }),
    diskWith(acme),
  )
})

describe("todo promote", () => {
  effectTest(
    "moves an inline task into its own file and leaves a link",
    Effect.gen(function* () {
      const result = yield* todo("promote", "3")
      expect(result).toEqual({
        code: 0,
        stdout: "03  Fix login redirect now has its own file",
        stderr: "",
      })
      const disk = yield* Disk
      expect(yield* disk.read("backend/03-fix-login-redirect.md")).toBe(
        md(
          "---",
          "title: Fix login redirect",
          "tags: [bug]",
          "assignee: lemol",
          "depends_on: [2]",
          "---",
          "Users land on /home.",
        ),
      )
      expect(yield* disk.read("TODO.md")).toContain(
        "- [ ] [03 - Fix login redirect](./backend/03-fix-login-redirect.md)\n",
      )
    }),
    diskWith(acme),
  )

  effectTest(
    "says the same thing for a task that already has one, and reports unknown IDs",
    Effect.gen(function* () {
      expect((yield* todo("promote", "2")).stdout).toBe(
        "02  Add rate limiting now has its own file",
      )
      expect(yield* (yield* Disk).read("backend/02-add-rate-limiting.md")).toBe(
        acme["backend/02-add-rate-limiting.md"],
      )
      expect(yield* todo("promote", "99")).toEqual({
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

  effectTest(
    "--file moves the task into its own file, with a description read from stdin",
    Effect.gen(function* () {
      const result = yield* runTodo(["edit", "3", "--file", "--description", "-"], {
        stdin: "The referrer is dropped by `redirect()`.\n",
      })

      expect(result.stdout).toBe("Updated 03  Fix login redirect")
      expect(yield* (yield* Disk).read("backend/03-fix-login-redirect.md")).toContain(
        "The referrer is dropped by `redirect()`.",
      )
    }),
    diskWith(acme),
  )

  effectTest(
    "--file on its own is enough of a change",
    Effect.gen(function* () {
      expect((yield* todo("edit", "1", "--file")).code).toBe(0)
      expect(yield* (yield* Disk).exists("01-write-changelog.md")).toBe(true)
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

describe("todo cancel", () => {
  effectTest(
    "records the reason and takes the task off the list",
    Effect.gen(function* () {
      const result = yield* todo("cancel", "3", "--reason", "Superseded by d47fcd2.")
      expect(result.stdout).toBe(
        lines("Cancelled 03  Fix login redirect", "  Superseded by d47fcd2."),
      )
      const disk = yield* Disk
      expect(yield* disk.read("done/backend/03-fix-login-redirect.md")).toContain(
        "cancelled_reason: Superseded by d47fcd2.",
      )
      expect(yield* disk.read("TODO.md")).not.toContain("03 - Fix login redirect")
    }),
    diskWith(acme),
  )

  effectTest(
    "reads the reason from stdin when given -",
    Effect.gen(function* () {
      const result = yield* runTodo(["cancel", "3", "--reason", "-"], {
        stdin: "Dropped: `apps/*` is gone.\n",
      })

      expect(result.stdout).toContain("Cancelled 03")
      expect(yield* (yield* Disk).read("done/backend/03-fix-login-redirect.md")).toContain(
        "Dropped: `apps/*` is gone.",
      )
    }),
    diskWith(acme),
  )

  effectTest(
    "without a reason is a usage error",
    Effect.gen(function* () {
      const result = yield* todo("cancel", "3")
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain("--reason")
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

  effectTest(
    "refuses comment body with unescaped depth-2 heading",
    Effect.gen(function* () {
      const disk = yield* Disk
      const beforeTodo = yield* disk.read("TODO.md")
      const beforeTree = yield* disk.tree()
      const result = yield* todo("comment", "1", "##", "Broken", "Heading")

      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain("comment body must not contain unescaped headings")
      expect(yield* disk.read("TODO.md")).toBe(beforeTodo)
      expect(yield* disk.tree()).toEqual(beforeTree)
      expect((yield* showJson("1")).comments).toEqual([])
    }),
    diskWith(acme),
  )
})

describe("todo comment -", () => {
  const body = 'Found the cause: `git rev-parse` returned nothing, and $(date) is "off".\n'

  effectTest(
    "reads the body from stdin, keeping what the shell would have run",
    Effect.gen(function* () {
      const result = yield* runTodo(["comment", "1", "-", "--author", "claude"], { stdin: body })
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
          body.trimEnd(),
        ),
      )
    }),
    diskWith(acme),
  )

  effectTest(
    "says so when nothing was piped in, rather than commenting nothing",
    Effect.gen(function* () {
      const result = yield* todo("comment", "1", "-")
      expect(result.code).toBe(2)
      expect(result.stderr).toBe("error: comment - got nothing on stdin; pipe the text in")
      expect((yield* showJson("1")).comments).toEqual([])
    }),
    diskWith(acme),
  )

  effectTest(
    "leaves a dash among other words alone",
    Effect.gen(function* () {
      yield* runTodo(["comment", "1", "waiting", "-", "see", "03"], { stdin: body })
      expect((yield* showJson("1")).comments).toEqual([
        { author: "tester", at: "1970-01-01T00:00:00.000Z", body: "waiting - see 03" },
      ])
    }),
    diskWith(acme),
  )
})

describe("todo add with cross-project dependencies", () => {
  effectTest(
    "does not retarget and holds task back until the foreign task is done",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const home = `${root}/home`
      yield* runTodo(["projects", "add", "w", "--name", "workspace"], { home })
      yield* runTodo(["projects", "add", "s", "--name", "slash-usage"], { home })

      const addResult = yield* runTodo(
        [
          "add",
          "Dependent Task",
          "--project",
          "workspace",
          "--quick",
          "--depends-on",
          "slash-usage:1",
        ],
        { home },
      )

      expect(addResult.code).toBe(0)
      expect(addResult.stdout).toContain("Added 01  Dependent Task")

      const nextBefore = yield* runTodo(["next", "--project", "workspace"], { home })
      expect(nextBefore.stdout).toBe("Nothing is ready.")

      yield* runTodo(["add", "Blocking Task", "--project", "slash-usage", "--quick"], { home })

      const showResult = yield* runTodo(["show", "--project", "workspace", "01"], { home })
      expect(showResult.stdout).toContain("blocked by slash-usage:01")
      expect(showResult.stdout).toContain("slash-usage:01  Blocking Task  ready")

      const lsResult = yield* runTodo(["ls", "--project", "workspace"], { home })
      expect(lsResult.stdout).toContain("01  Dependent Task")
      expect(lsResult.stdout).toContain("blocked by slash-usage:01")

      const doneResult = yield* runTodo(["done", "slash-usage:1"], { home })
      expect(doneResult.stdout).toContain("workspace:01  Dependent Task")
    }),
    diskWith({
      "w/TODO.md": "# Workspace\n",
      "s/TODO.md": "# Slash Usage\n",
    }),
  )

  effectTest(
    "rejects an anchor in another project instead of retargeting",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const home = `${root}/home`
      yield* runTodo(["projects", "add", "w", "--name", "workspace"], { home })
      yield* runTodo(["projects", "add", "s", "--name", "slash-usage"], { home })
      yield* runTodo(["add", "Seed task", "--project", "slash-usage", "--quick"], { home })

      // From workspace's own directory, without --project: must fail, not add to slash-usage.
      const retarget = yield* runTodo(
        ["add", "Anchor probe", "--quick", "--before", "slash-usage:1"],
        { home, cwd: "w" },
      )

      expect(retarget.code).toBe(2)
      expect(retarget.stderr).toContain("anchor project slash-usage contradicts workspace")

      const flagged = yield* runTodo(
        ["add", "Anchor probe", "--quick", "--project", "workspace", "--before", "slash-usage:1"],
        { home },
      )

      expect(flagged.code).toBe(2)
      expect(flagged.stderr).toContain("anchor project slash-usage contradicts workspace")

      expect(yield* (yield* Disk).read("s/TODO.md")).not.toContain("Anchor probe")
      expect(yield* (yield* Disk).read("w/TODO.md")).not.toContain("Anchor probe")
    }),
    diskWith({
      "w/TODO.md": "# Workspace\n",
      "s/TODO.md": "# Slash Usage\n",
    }),
  )
})
