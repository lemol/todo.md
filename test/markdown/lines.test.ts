import { describe, expect, test } from "bun:test"
import { joinLines, spliceLines, splitLines, trimBlock } from "../../src/markdown/lines.ts"

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
