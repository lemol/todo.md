import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { effectTest } from "../../src/spec/testing.ts"
import { diskWith, md } from "../fs/helpers.ts"
import { acme, lines } from "./fixtures.ts"
import { runTodo, todo } from "./harness.ts"

describe("todo / todo list", () => {
  effectTest(
    "shows the outline of open tasks, what blocks them, and a summary",
    Effect.gen(function* () {
      const expected = lines(
        "Acme API",
        "",
        "  01  Write changelog",
        "",
        "Backend",
        "  02  Add rate limiting   #api",
        "  03  Fix login redirect  #bug @lemol",
        "      blocked by 02",
        "",
        "Frontend",
        "  04  Fix layout  @claude",
        "",
        "4 open · 3 ready · 1 blocked",
      )

      expect(yield* todo()).toEqual({ code: 0, stdout: expected, stderr: "" })
      expect((yield* todo("list")).stdout).toBe(expected)
      expect((yield* todo("ls")).stdout).toBe(expected)
    }),
    diskWith(acme),
  )

  effectTest(
    "filters by tag, assignee, group and state",
    Effect.gen(function* () {
      expect((yield* todo("ls", "--tag", "bug")).stdout).toBe(
        lines(
          "Acme API",
          "",
          "Backend",
          "  03  Fix login redirect  #bug @lemol",
          "      blocked by 02",
          "",
          "1 open · 0 ready · 1 blocked",
        ),
      )
      expect((yield* todo("ls", "--assignee", "claude")).stdout).toContain("04  Fix layout")
      expect((yield* todo("ls", "--group", "Frontend")).stdout).not.toContain("01")
      expect((yield* todo("ls", "--blocked")).stdout).toContain("1 open · 0 ready · 1 blocked")
      expect((yield* todo("ls", "--tag", "nope")).stdout).toBe(lines("Acme API", "", "No tasks."))
    }),
    diskWith(acme),
  )

  effectTest(
    "shows done tasks with --done and --all",
    Effect.gen(function* () {
      expect((yield* todo("list", "--done")).stdout).toBe(
        lines("Acme API", "", "Done", "  05  Set up CI  2026-09-10", "", "1 done"),
      )
      expect((yield* todo("list", "--all")).stdout).toContain(
        "4 open · 3 ready · 1 blocked · 1 done",
      )
    }),
    diskWith(acme),
  )

  effectTest(
    "prints the listing as JSON",
    Effect.gen(function* () {
      const listing = JSON.parse((yield* todo("list", "--ready", "--json")).stdout)
      type Section = { name?: string; tasks: { task: { id: string }; state: string }[] }
      expect(listing.title).toBe("Acme API")
      expect(
        listing.sections.map((s: Section) => [
          s.name ?? null,
          s.tasks.map((v) => [v.task.id, v.state]),
        ]),
      ).toEqual([
        [null, [["1", "ready"]]],
        ["Backend", [["2", "ready"]]],
        ["Frontend", [["4", "ready"]]],
      ])
      expect(listing.done).toEqual([])
    }),
    diskWith(acme),
  )

  effectTest(
    "rejects --ready together with --blocked",
    Effect.gen(function* () {
      const result = yield* todo("list", "--ready", "--blocked")

      expect(result.code).toBe(2)
      expect(result.stderr).toBe("error: use --ready or --blocked, not both")
    }),
    diskWith(acme),
  )

  effectTest(
    "colors the output on a terminal",
    Effect.gen(function* () {
      const result = yield* runTodo([], { color: true })

      expect(result.stdout.startsWith("\u001b[1mAcme API\u001b[22m")).toBe(true)
      expect(result.stdout).toContain("\u001b[33mblocked by 02\u001b[39m")
    }),
    diskWith(acme),
  )
})

describe("todo next", () => {
  effectTest(
    "shows the most important ready task, or more with --limit",
    Effect.gen(function* () {
      expect((yield* todo("next")).stdout).toBe("  01  Write changelog")
      expect((yield* todo("next", "--limit", "0")).stdout).toBe(
        lines(
          "  01  Write changelog",
          "  02  Add rate limiting  #api",
          "  04  Fix layout         @claude",
        ),
      )
      expect((yield* todo("next", "--group", "Nope")).stdout).toBe("Nothing is ready.")
      const json = JSON.parse((yield* todo("next", "--assignee", "claude", "--json")).stdout)

      expect(json.map((v: { task: { id: string } }) => v.task.id)).toEqual(["4"])
    }),
    diskWith(acme),
  )
})

describe("todo show", () => {
  effectTest(
    "shows a task's state, description, dependencies and comments",
    Effect.gen(function* () {
      expect((yield* todo("show", "02")).stdout).toBe(
        lines(
          "02  Add rate limiting",
          "    ready · Backend · #api",
          "",
          "    Token bucket per API key.",
          "",
          "    Blocks",
          "      03  Fix login redirect  blocked",
          "",
          "    Comments",
          "      @lemol at 2026-09-12 12:00",
          "        Started.",
        ),
      )
      expect((yield* todo("show", "3")).stdout).toBe(
        lines(
          "03  Fix login redirect",
          "    blocked by 02 · Backend · #bug @lemol",
          "",
          "    Users land on /home.",
          "",
          "    Depends on",
          "      02  Add rate limiting  ready",
        ),
      )
      expect(JSON.parse((yield* todo("show", "3", "--json")).stdout).view.blockedBy).toEqual(["2"])
    }),
    diskWith(acme),
  )

  effectTest(
    "fails for an unknown task",
    Effect.gen(function* () {
      expect(yield* todo("show", "99")).toEqual({
        code: 1,
        stdout: "",
        stderr: "error: no task 99",
      })
      const json = yield* todo("show", "99", "--json")

      expect(JSON.parse(json.stderr)).toEqual({
        error: { tag: "TaskNotFound", message: "no task 99", id: "99" },
      })
    }),
    diskWith(acme),
  )
})

describe("todo check", () => {
  effectTest(
    "reports a clean list",
    Effect.gen(function* () {
      expect(yield* todo("check")).toEqual({ code: 0, stdout: "No problems found.", stderr: "" })
    }),
    diskWith(acme),
  )

  effectTest(
    "lists problems, errors first, and exits with 1 when there are errors",
    Effect.gen(function* () {
      expect(yield* todo("check")).toEqual({
        code: 1,
        stdout: lines(
          "error    TODO.md:1  broken-link  01-missing.md does not exist",
          "error    task 02  unknown-dependency  task 2 depends on unknown task 9",
          "",
          "2 errors",
        ),
        stderr: "",
      })
      const json = yield* todo("check", "--json")

      expect(json.code).toBe(1)
      expect(JSON.parse(json.stdout).map((d: { code: string }) => d.code)).toEqual([
        "broken-link",
        "unknown-dependency",
      ])
      expect(json.stderr).toBe("")
    }),
    diskWith({
      "TODO.md": md("- [ ] [01 - Missing](./01-missing.md)", "- [ ] 02 - Waits", "  depends_on:9"),
    }),
  )
})
