import { describe, expect, test } from "bun:test"
import type { Heading } from "mdast"
import { headingText, lineSpan, parseAst } from "../../src/markdown/ast.ts"

describe("parseAst and lineSpan", () => {
  test("parses markdown nodes with 0-based line ranges", () => {
    const doc = ["# Title", "", "Paragraph line 1", "Paragraph line 2"].join("\n")
    const tree = parseAst(doc)
    const [first, second] = tree.children

    if (first === undefined || second === undefined) throw new Error("expected 2 children")

    expect(lineSpan(first)).toEqual({ start: 0, end: 1 })
    expect(lineSpan(second)).toEqual({ start: 2, end: 4 })
  })
})

describe("headingText", () => {
  test("extracts heading text and column range", () => {
    const source = "## Backend"
    const heading = parseAst(source).children[0] as Heading

    expect(headingText(source, heading)).toEqual({ text: "Backend", from: 3, to: 10 })
  })

  test("trims leading and trailing whitespace and adjusts from and to", () => {
    const mockHeading: Heading = {
      type: "heading",
      depth: 2,
      children: [
        {
          type: "text",
          value: "  Padded Heading  ",
          position: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 1, column: 19, offset: 18 },
          },
        },
      ],
    }

    const source = "  Padded Heading  "
    const res = headingText(source, mockHeading)

    expect(res).toEqual({
      text: "Padded Heading",
      from: 2,
      to: 16,
    })
    expect(source.slice(res.from, res.to)).toBe("Padded Heading")
  })

  test("handles empty or whitespace-only heading", () => {
    const noChildren: Heading = {
      type: "heading",
      depth: 2,
      children: [],
    }

    expect(headingText("##", noChildren)).toEqual({ text: "", from: 0, to: 0 })

    const whitespaceHeading: Heading = {
      type: "heading",
      depth: 2,
      children: [
        {
          type: "text",
          value: "   ",
          position: {
            start: { line: 1, column: 4, offset: 3 },
            end: { line: 1, column: 7, offset: 6 },
          },
        },
      ],
    }

    expect(headingText("##    ", whitespaceHeading)).toEqual({ text: "", from: 3, to: 3 })
  })
})
