import { expect, test } from "bun:test"
import {
  InvalidProjectConfig,
  NoListFound,
  ProjectNotFound,
  SourceUnavailable,
} from "../../src/hub/errors.ts"

test("hub errors explain themselves", () => {
  expect(new ProjectNotFound({ name: "x" }).message).toBe("no project named x")
  expect(new NoListFound({ cwd: "/work" }).message).toBe(
    "no todo.md list found from /work; run `todo init` or pass --dir",
  )
  expect(new InvalidProjectConfig({ name: "x", issues: ["a", "b"] }).message).toBe(
    "project x has an invalid config: a; b",
  )
  expect(new SourceUnavailable({ name: "w", source: "jira" }).message).toBe(
    "project w uses the jira source, which is not available here",
  )
})
