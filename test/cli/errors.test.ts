import { describe, expect, test } from "bun:test"
import {
  describeError,
  errorJson,
  exitCodeOf,
  NoListFound,
  ProblemsFound,
  UsageError,
} from "../../src/cli/errors.ts"
import { HasDependents } from "../../src/core/index.ts"
import {
  GroupNotFound,
  InvalidTransition,
  StoreError,
  TaskNotFound,
  Unsupported,
  ValidationError,
} from "../../src/spec/index.ts"

describe("describeError", () => {
  test.each([
    [new TaskNotFound({ id: "9" }), "no task 9"],
    [new GroupNotFound({ name: "Backend" }), 'no group "Backend"'],
    [
      new InvalidTransition({ id: "2", status: "done", operation: "complete" }),
      "task 2 is done, so it cannot be completed",
    ],
    [
      new InvalidTransition({ id: "2", status: "done", operation: "move" }),
      "task 2 is done, so it cannot be moved",
    ],
    [new ValidationError({ issues: ["a", "b"] }), "invalid input: a, b"],
    [new Unsupported({ operation: "comment" }), "this list does not support comment"],
    [
      new HasDependents({ id: "2", dependents: ["3", "5"] }),
      "task 2 is needed by 3, 5; use --force to remove it anyway",
    ],
    [
      new NoListFound({ cwd: "/work" }),
      "no todo.md list found from /work; run `todo init` or pass --dir",
    ],
    [new UsageError({ message: "say where" }), "say where"],
    [new StoreError({ message: "disk full" }), "disk full"],
  ])("%s", (error, message) => {
    expect(describeError(error)).toBe(message)
  })
})

test("errorJson keeps the tag, the message and plain fields", () => {
  expect(errorJson(new HasDependents({ id: "2", dependents: ["3"] }))).toEqual({
    tag: "HasDependents",
    message: "task 2 is needed by 3; use --force to remove it anyway",
    id: "2",
    dependents: ["3"],
  })
  expect(errorJson(new StoreError({ message: "disk full", cause: new Error("x") }))).toEqual({
    tag: "StoreError",
    message: "disk full",
  })
})

test("exitCodeOf: 2 for usage errors, 1 for everything else", () => {
  expect(exitCodeOf(new UsageError({ message: "x" }))).toBe(2)
  expect(exitCodeOf({ _tag: "ShowHelp" })).toBe(2)
  expect(exitCodeOf(new TaskNotFound({ id: "9" }))).toBe(1)
  expect(exitCodeOf(new ProblemsFound({ errors: 2 }))).toBe(1)
})
