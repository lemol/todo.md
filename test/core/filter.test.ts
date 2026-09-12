import { expect, test } from "bun:test"
import { matches } from "../../src/core/filter.ts"
import { viewOf } from "../../src/core/views.ts"
import { task } from "./fixtures.ts"

const view = viewOf(
  task({ id: "1", tags: ["api", "bug"], assignee: "lemol", group: "Backend", dependsOn: ["9"] }),
  new Set(),
)

test.each([
  ["no conditions", {}, true],
  ["all of its tags", { tags: ["bug", "api"] }, true],
  ["a tag it lacks", { tags: ["bug", "ui"] }, false],
  ["its assignee", { assignee: "lemol" }, true],
  ["another assignee", { assignee: "claude" }, false],
  ["its group", { group: "Backend" }, true],
  ["another group", { group: "Frontend" }, false],
  ["its state", { state: "blocked" as const }, true],
  ["another state", { state: "ready" as const }, false],
])("a filter on %s matches: %p", (_label, filter, expected) => {
  expect(matches(filter)(view)).toBe(expected)
})
