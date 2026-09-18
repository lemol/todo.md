import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { CommentInput, Label, Task, TaskInput, TaskPatch } from "../../src/spec/model.ts"

const accepts = <S extends Schema.Top>(schema: S, value: unknown) =>
  expect(Schema.is(schema)(value)).toBe(true)
const rejects = <S extends Schema.Top>(schema: S, value: unknown) =>
  expect(Schema.is(schema)(value)).toBe(false)

describe("Label", () => {
  test("accepts non-empty single-line trimmed text", () => {
    accepts(Label, "Fix login redirect")
    accepts(Label, "API & Auth")
  })

  test("rejects empty, multi-line or padded text", () => {
    rejects(Label, "")
    rejects(Label, "two\nlines")
    rejects(Label, " padded ")
  })
})

describe("TaskInput", () => {
  test("requires only a title", () => {
    accepts(TaskInput, { title: "Write changelog" })
  })

  test("rejects a missing title and empty tags", () => {
    rejects(TaskInput, {})
    rejects(TaskInput, { title: "x", tags: [""] })
  })
})

describe("TaskPatch", () => {
  test("accepts null to clear the assignee", () => {
    accepts(TaskPatch, { assignee: null })
  })
})

describe("CommentInput", () => {
  test("requires a handle without whitespace and a non-empty body", () => {
    accepts(CommentInput, { author: "lemol", body: "Started." })
    rejects(CommentInput, { author: "le mol", body: "Started." })
    rejects(CommentInput, { author: "lemol", body: "" })
  })
})

describe("Task outcome", () => {
  const base = {
    id: "1",
    title: "Ship it",
    description: "",
    status: "done",
    tags: [],
    dependsOn: [],
    comments: [],
    extra: {},
  }

  test("a done task may be completed or cancelled", () => {
    accepts(Task, { ...base, outcome: "completed" })
    accepts(Task, { ...base, outcome: "cancelled", cancelledReason: "Superseded." })
  })

  test("an absent outcome is valid, and means completed", () => {
    accepts(Task, base)
  })

  test("rejects an outcome the model does not define", () => {
    rejects(Task, { ...base, outcome: "wontfix" })
  })
})
