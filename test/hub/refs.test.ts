import { describe, expect, test } from "bun:test"
import { formatRef, parseRef } from "../../src/hub/index.ts"
import {
  isValidName,
  formatRef as specFormatRef,
  parseRef as specParseRef,
} from "../../src/spec/index.ts"

describe("refs", () => {
  test("formats project:id", () => {
    expect(formatRef("todo-md", "12")).toBe("todo-md:12")
    expect(formatRef("work", "PROJ-7")).toBe("work:PROJ-7")
  })

  test("parses a qualified reference at its first colon", () => {
    expect(parseRef("todo-md:12")).toEqual({ project: "todo-md", id: "12" })
    expect(parseRef("work:PROJ-7")).toEqual({ project: "work", id: "PROJ-7" })
    expect(parseRef("a:b:c")).toEqual({ project: "a", id: "b:c" })
  })

  test("keeps plain IDs whole and unchanged", () => {
    expect(parseRef("12")).toEqual({ id: "12" })
    expect(parseRef("007")).toEqual({ id: "007" })
    expect(parseRef("PROJ-7")).toEqual({ id: "PROJ-7" })
  })

  test("treats text without a valid project name or ID as a plain ID", () => {
    expect(parseRef("My App:1")).toEqual({ id: "My App:1" })
    expect(parseRef(":1")).toEqual({ id: ":1" })
    expect(parseRef("work:")).toEqual({ id: "work:" })
  })

  test("round-trips", () => {
    for (const [project, id] of [
      ["todo-md", "12"],
      ["work", "PROJ-7"],
      ["a", "b:c"],
    ] as const) {
      expect(parseRef(formatRef(project, id))).toEqual({ project, id })
    }
  })

  test("exports ref parsing and validation from spec", () => {
    expect(isValidName("slash-usage")).toBe(true)
    expect(isValidName("Invalid Name")).toBe(false)
    expect(specParseRef("slash-usage:1")).toEqual({ project: "slash-usage", id: "1" })
    expect(specFormatRef("slash-usage", "1")).toBe("slash-usage:1")
  })
})
