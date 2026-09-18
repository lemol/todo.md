import { describe, expect, test } from "bun:test"
import { DateTime } from "effect"
import {
  fieldsOf,
  fileTask,
  fitsInline,
  inlineItemFor,
  inlineTask,
  linkedItemFor,
  taskFileFor,
} from "../../src/markdown/convert.ts"
import { formatTaskFile, parseTaskFile } from "../../src/markdown/taskFile.ts"
import { findItem, parseTodoFile } from "../../src/markdown/todoFile.ts"
import type { Task } from "../../src/spec/index.ts"

const task: Task = {
  id: "3",
  title: "Fix login redirect",
  description: "Users land on /home.",
  status: "open",
  tags: ["bug"],
  assignee: "lemol",
  dependsOn: ["1"],
  comments: [],
  group: "Backend",
  completedAt: undefined,
  extra: { estimate: 3 },
}

describe("inline tasks", () => {
  test("an inline item round-trips through the model", () => {
    const todo = parseTodoFile(`## Backend\n\n${inlineItemFor(task).join("\n")}\n`)
    const item = findItem(todo, "3")
    if (item === undefined) throw new Error("no item")
    expect(inlineTask(item, "3", "Backend")).toEqual(task)
  })

  test("a checked item is done", () => {
    const todo = parseTodoFile("- [x] 03 - Fix login redirect\n")
    const item = findItem(todo, "3")
    if (item === undefined) throw new Error("no item")
    expect(inlineTask(item, "3", undefined)).toMatchObject({
      status: "done",
      completedAt: undefined,
    })
  })

  test("fitsInline requires no comments and single-token fields", () => {
    expect(fitsInline(task)).toBe(true)
    expect(fitsInline({ ...task, tags: ["needs review"] })).toBe(false)
    expect(
      fitsInline({ ...task, comments: [{ author: "a", at: DateTime.makeUnsafe(0), body: "Hi." }] }),
    ).toBe(false)
    expect(fitsInline({ ...task, extra: { nested: { a: 1 } } })).toBe(false)
  })

  test("fieldsOf extracts inline metadata fields from task", () => {
    expect(fieldsOf(task)).toEqual({
      tags: ["bug"],
      assignee: "lemol",
      dependsOn: ["1"],
      extra: { estimate: 3 },
    })
  })
})

describe("file-backed tasks", () => {
  test("a task file round-trips through the model", () => {
    const file = parseTaskFile(
      formatTaskFile(taskFileFor(task)),
      "backend/03-fix-login-redirect.md",
    )
    expect(fileTask("3", file, { title: "ignored", status: "open", group: "Backend" })).toEqual(
      task,
    )
  })

  test("the link text is the fallback title", () => {
    const file = parseTaskFile("Notes.\n", "03-notes.md")
    expect(
      fileTask("3", file, { title: "From the link", status: "open", group: undefined }).title,
    ).toBe("From the link")
  })

  test("only done tasks write group and completion time", () => {
    expect(taskFileFor(task)).toMatchObject({ group: undefined, completedAt: undefined })
    const at = DateTime.makeUnsafe("2026-09-12T10:31:00Z")
    expect(taskFileFor({ ...task, status: "done", completedAt: at })).toMatchObject({
      group: "Backend",
      completedAt: at,
    })
  })

  test("linkedItemFor links to the file", () => {
    expect(linkedItemFor(task, "backend/03-fix-login-redirect.md")).toEqual([
      "- [ ] [03 - Fix login redirect](./backend/03-fix-login-redirect.md)",
    ])
  })

  test("an open item's file outcome is ignored, not carried into the model", () => {
    const file = parseTaskFile(
      formatTaskFile({ ...taskFileFor(task), outcome: "cancelled", cancelledReason: "Why not." }),
      "backend/03-fix-login-redirect.md",
    )
    expect(
      fileTask("3", file, { title: "ignored", status: "open", group: "Backend" }),
    ).toMatchObject({ outcome: undefined, cancelledReason: undefined })
  })
})
