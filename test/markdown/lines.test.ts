import { describe, expect, test } from "bun:test"
import {
  joinLines,
  spliceLines,
  splitLines,
  textLines,
  trimBlock,
} from "../../src/markdown/lines.ts"

describe("splitLines / joinLines", () => {
  test.each([
    ["", []],
    ["a", ["a"]],
    ["a\nb\n", ["a", "b"]],
    ["a\r\nb\r\n", ["a", "b"]],
    ["a\n\n", ["a", ""]],
  ])("round-trips %j", (text, lines) => {
    const split = splitLines(text)

    expect(split.lines).toEqual(lines)
    expect(joinLines(split)).toBe(text)
  })

  test("keeps CRLF line endings", () => {
    const text = spliceLines(splitLines("a\r\nc\r\n"), 1, 0, ["b"])

    expect(joinLines(text)).toBe("a\r\nb\r\nc\r\n")
  })
})

describe("spliceLines", () => {
  test("replaces lines in the middle", () => {
    expect(joinLines(spliceLines(splitLines("a\nb\nc\n"), 1, 1, ["x", "y"]))).toBe("a\nx\ny\nc\n")
  })

  test("ends the text with a newline when appending", () => {
    expect(joinLines(spliceLines(splitLines("a"), 1, 0, ["b"]))).toBe("a\nb\n")
    expect(joinLines(spliceLines(splitLines(""), 0, 0, ["a"]))).toBe("a\n")
  })
})

test("trimBlock drops leading and trailing blank lines", () => {
  expect(trimBlock(["", "a", "", "b", " ", ""])).toBe("a\n\nb")
})

describe("textLines", () => {
  test.each([
    ["a", ["a"]],
    ["a\nb", ["a", "b"]],
    ["a\r\nb", ["a", "b"]],
    ["a\rb", ["a", "b"]],
    ["a\r\n", ["a", ""]],
  ])("splits %j on any line ending", (text, lines) => {
    expect(textLines(text)).toEqual(lines)
  })
})

describe("mixed line endings", () => {
  test.each([
    ["a\nb\r\nc\n", "a\nb\nc\n"],
    ["a\r\nb\nc\r\n", "a\r\nb\r\nc\r\n"],
    ["a\r\nb\n", "a\nb\n"],
  ])("writes %j in its most common line ending, LF on a tie", (text, joined) => {
    expect(joinLines(splitLines(text))).toBe(joined)
  })
})

describe("lone carriage returns", () => {
  test.each([
    ["a\rb\nc\n", ["a", "b", "c"]],
    ["a\rb\r\nc\r\n", ["a", "b", "c"]],
    ["a\r", ["a"]],
    ["a\r\rb", ["a", "", "b"]],
  ])("split %j into lines and join it back unchanged", (text, lines) => {
    const split = splitLines(text)

    expect(split.lines).toEqual(lines)
    expect(joinLines(split)).toBe(text)
  })

  test("a line an edit writes takes the file's line ending", () => {
    expect(joinLines(spliceLines(splitLines("a\rb\nc\n"), 0, 1, ["x"]))).toBe("x\nb\nc\n")
    expect(joinLines(spliceLines(splitLines("a\rb\r\nc\r\n"), 1, 0, ["x"]))).toBe(
      "a\rx\r\nb\r\nc\r\n",
    )
  })
})
