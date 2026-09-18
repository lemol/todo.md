import { describe, expect, test } from "bun:test"
import { DateTime } from "effect"
import {
  label,
  renderCancellation,
  renderCompletions,
  renderDetail,
  renderDiagnostics,
  renderListing,
  showId,
  taskLines,
} from "../../src/cli/render.ts"
import { styleFor } from "../../src/cli/style.ts"
import { viewOf } from "../../src/core/index.ts"
import { task } from "../core/fixtures.ts"

const plain = styleFor(false)
const done = new Set(["1"])
const ready = viewOf(task({ id: "2", title: "Add rate limiting", tags: ["api"] }), done)
const blocked = viewOf(
  task({
    id: "3",
    title: "Fix login redirect",
    tags: ["bug"],
    assignee: "lemol",
    dependsOn: ["2"],
  }),
  done,
)

describe("names", () => {
  test("showId pads numeric IDs to two digits and leaves others alone", () => {
    expect([showId("7"), showId("12"), showId("105"), showId("PROJ-1")]).toEqual([
      "07",
      "12",
      "105",
      "PROJ-1",
    ])
  })

  test("label is the ID and title", () => {
    expect(label(ready.task)).toBe("02  Add rate limiting")
  })
})

describe("taskLines", () => {
  test("aligns extras and puts a blocked-by line under blocked tasks", () => {
    expect(taskLines([ready, blocked], plain)).toEqual([
      "  02  Add rate limiting   #api",
      "  03  Fix login redirect  #bug @lemol",
      "      blocked by 02",
    ])
  })

  test("shows a done task's completion date", () => {
    const finished = viewOf(
      task({
        id: "5",
        title: "Set up CI",
        status: "done",
        completedAt: DateTime.makeUnsafe("2026-09-10T08:00:00Z"),
      }),
      done,
    )
    expect(taskLines([finished], plain)).toEqual(["  05  Set up CI  2026-09-10"])
  })

  test("marks a cancelled task, so it does not read as finished work", () => {
    const cancelled = viewOf(
      task({
        id: "6",
        title: "Drop apps/ support",
        status: "done",
        completedAt: DateTime.makeUnsafe("2026-09-10T08:00:00Z"),
        outcome: "cancelled",
        cancelledReason: "Superseded by d47fcd2.",
      }),
      done,
    )
    expect(taskLines([cancelled], plain)).toEqual([
      "  06  Drop apps/ support  2026-09-10 cancelled",
    ])
  })
})

describe("renderListing", () => {
  const listing = {
    title: "Acme API",
    description: "",
    sections: [
      { name: undefined, description: "", tasks: [] },
      { name: "Backend", description: "", tasks: [ready, blocked] },
      { name: "Empty", description: "", tasks: [] },
    ],
    done: [],
  }

  test("prints the title, non-empty sections and a summary", () => {
    expect(renderListing(listing, plain)).toEqual([
      "Acme API",
      "",
      "Backend",
      "  02  Add rate limiting   #api",
      "  03  Fix login redirect  #bug @lemol",
      "      blocked by 02",
      "",
      "2 open · 1 ready · 1 blocked",
    ])
  })

  test("says when there is nothing to show", () => {
    expect(renderListing({ ...listing, sections: [] }, plain)).toEqual([
      "Acme API",
      "",
      "No tasks.",
    ])
  })
})

test("renderDetail shows state, facts and dependencies", () => {
  expect(
    renderDetail(
      {
        view: blocked,
        dependencies: [{ id: "2", title: "Add rate limiting", state: "ready" }],
        blocks: [],
      },
      plain,
    ),
  ).toEqual([
    "03  Fix login redirect",
    "    blocked by 02 · #bug @lemol",
    "",
    "    Depends on",
    "      02  Add rate limiting  ready",
  ])
})

test("renderCompletions lists each completed task, then the newly ready ones once", () => {
  const unblocked = viewOf(task({ id: "3", title: "Fix login redirect" }), new Set(["2"]))
  expect(
    renderCompletions(
      [
        { task: ready.task, unblocked: [unblocked] },
        { task: task({ id: "4", title: "Other" }), unblocked: [unblocked] },
      ],
      plain,
    ),
  ).toEqual([
    "Done 02  Add rate limiting",
    "Done 04  Other",
    "Now ready:",
    "  03  Fix login redirect",
  ])
})

test("renderCancellation names the task and its reason; nothing becomes ready", () => {
  expect(
    renderCancellation(
      task({
        id: "6",
        title: "Drop apps/ support",
        outcome: "cancelled",
        cancelledReason: "Superseded by d47fcd2.",
      }),
      plain,
    ),
  ).toEqual(["Cancelled 06  Drop apps/ support", "  Superseded by d47fcd2."])
})

describe("renderDiagnostics", () => {
  test("sorts errors first and summarizes", () => {
    expect(
      renderDiagnostics(
        [
          {
            severity: "warning",
            code: "orphan-file",
            message: "no item links to x.md",
            file: "x.md",
          },
          {
            severity: "error",
            code: "broken-link",
            message: "y.md does not exist",
            file: "TODO.md",
            line: 4,
          },
          { severity: "info", code: "missing-id", message: "needs an ID", taskId: "7" },
        ],
        plain,
      ),
    ).toEqual([
      "error    TODO.md:4  broken-link  y.md does not exist",
      "warning  x.md  orphan-file  no item links to x.md",
      "info     task 07  missing-id  needs an ID",
      "",
      "1 error · 1 warning · 1 note",
    ])
  })

  test("says when there are no problems", () => {
    expect(renderDiagnostics([], plain)).toEqual(["No problems found."])
  })
})
