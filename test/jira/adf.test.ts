import { describe, expect, test } from "bun:test"
import { adfToMarkdown } from "../../src/jira/adf.ts"

/** A `doc` around the given block nodes, as Jira sends one. */
const doc = (...content: ReadonlyArray<unknown>) => ({ type: "doc", version: 1, content })
const text = (value: string, marks?: ReadonlyArray<unknown>) => ({
  type: "text",
  text: value,
  ...(marks === undefined ? {} : { marks }),
})

const paragraph = (...content: ReadonlyArray<unknown>) => ({ type: "paragraph", content })

describe("adfToMarkdown: text and paragraphs", () => {
  test("renders nothing for an absent document", () => {
    expect(adfToMarkdown(undefined)).toBe("")
    expect(adfToMarkdown(null)).toBe("")
  })

  test("joins paragraphs with a blank line", () => {
    expect(adfToMarkdown(doc(paragraph(text("First.")), paragraph(text("Second."))))).toBe(
      "First.\n\nSecond.",
    )
  })

  test("renders an empty paragraph as a blank line between blocks", () => {
    expect(adfToMarkdown(doc(paragraph(text("One.")), { type: "paragraph" }))).toBe("One.")
  })

  test("applies each text mark", () => {
    const marked = (mark: unknown) => adfToMarkdown(doc(paragraph(text("x", [mark]))))

    expect(marked({ type: "strong" })).toBe("**x**")
    expect(marked({ type: "em" })).toBe("*x*")
    expect(marked({ type: "code" })).toBe("`x`")
    expect(marked({ type: "strike" })).toBe("~~x~~")
    expect(marked({ type: "link", attrs: { href: "https://example.test" } })).toBe(
      "[x](https://example.test)",
    )
  })

  test("nests marks in the order Jira lists them", () => {
    expect(adfToMarkdown(doc(paragraph(text("x", [{ type: "strong" }, { type: "em" }]))))).toBe(
      "***x***",
    )
  })

  test("leaves an unknown mark's text alone", () => {
    expect(adfToMarkdown(doc(paragraph(text("x", [{ type: "textColor" }]))))).toBe("x")
  })

  test("breaks a line on hardBreak", () => {
    expect(adfToMarkdown(doc(paragraph(text("one"), { type: "hardBreak" }, text("two"))))).toBe(
      "one\ntwo",
    )
  })
})

describe("adfToMarkdown: headings, code and quotes", () => {
  const heading = (level: number, value: string) => ({
    type: "heading",
    attrs: { level },
    content: [text(value)],
  })

  test("renders a heading at its own level", () => {
    expect(adfToMarkdown(doc(heading(1, "Title"), heading(3, "Detail")))).toBe(
      "# Title\n\n### Detail",
    )
  })

  test("shifts headings down by headingShift", () => {
    expect(adfToMarkdown(doc(heading(1, "Title")), { headingShift: 3 })).toBe("#### Title")
  })

  test("caps a shifted heading at level 6", () => {
    expect(adfToMarkdown(doc(heading(5, "Deep"), heading(6, "Deeper")), { headingShift: 3 })).toBe(
      "###### Deep\n\n###### Deeper",
    )
  })

  test("fences a code block with its language", () => {
    expect(
      adfToMarkdown(
        doc({ type: "codeBlock", attrs: { language: "ts" }, content: [text("const x = 1")] }),
      ),
    ).toBe("```ts\nconst x = 1\n```")
  })

  test("fences a code block without a language", () => {
    expect(adfToMarkdown(doc({ type: "codeBlock", content: [text("plain")] }))).toBe(
      "```\nplain\n```",
    )
  })

  test("prefixes every line of a blockquote", () => {
    expect(
      adfToMarkdown(
        doc({ type: "blockquote", content: [paragraph(text("One.")), paragraph(text("Two."))] }),
      ),
    ).toBe("> One.\n>\n> Two.")
  })

  test("renders a rule", () => {
    expect(adfToMarkdown(doc(paragraph(text("a")), { type: "rule" }, paragraph(text("b"))))).toBe(
      "a\n\n---\n\nb",
    )
  })
})

describe("adfToMarkdown: lists", () => {
  const item = (...content: ReadonlyArray<unknown>) => ({ type: "listItem", content })
  const bullets = (...content: ReadonlyArray<unknown>) => ({ type: "bulletList", content })

  test("bullets a bulletList", () => {
    expect(
      adfToMarkdown(doc(bullets(item(paragraph(text("One"))), item(paragraph(text("Two")))))),
    ).toBe("- One\n- Two")
  })

  test("numbers an orderedList", () => {
    expect(
      adfToMarkdown(
        doc({
          type: "orderedList",
          content: [item(paragraph(text("One"))), item(paragraph(text("Two")))],
        }),
      ),
    ).toBe("1. One\n2. Two")
  })

  test("starts an orderedList at its order attribute", () => {
    expect(
      adfToMarkdown(
        doc({
          type: "orderedList",
          attrs: { order: 3 },
          content: [item(paragraph(text("Third")))],
        }),
      ),
    ).toBe("3. Third")
  })

  test("indents a nested list under its item", () => {
    expect(
      adfToMarkdown(
        doc(bullets(item(paragraph(text("Outer")), bullets(item(paragraph(text("Inner"))))))),
      ),
    ).toBe("- Outer\n  - Inner")
  })

  test("indents an item's later paragraphs", () => {
    expect(
      adfToMarkdown(doc(bullets(item(paragraph(text("One.")), paragraph(text("Still one.")))))),
    ).toBe("- One.\n\n  Still one.")
  })

  test("checks off a taskItem by its state", () => {
    expect(
      adfToMarkdown(
        doc({
          type: "taskList",
          content: [
            { type: "taskItem", attrs: { state: "TODO" }, content: [text("Open")] },
            { type: "taskItem", attrs: { state: "DONE" }, content: [text("Closed")] },
          ],
        }),
      ),
    ).toBe("- [ ] Open\n- [x] Closed")
  })
})

describe("adfToMarkdown: tables, panels and inline objects", () => {
  const cell = (type: string, value: string) => ({ type, content: [paragraph(text(value))] })
  const row = (...content: ReadonlyArray<unknown>) => ({ type: "tableRow", content })

  test("renders a table with a header row as GFM", () => {
    expect(
      adfToMarkdown(
        doc({
          type: "table",
          content: [
            row(cell("tableHeader", "Key"), cell("tableHeader", "Value")),
            row(cell("tableCell", "a"), cell("tableCell", "1")),
          ],
        }),
      ),
    ).toBe("| Key | Value |\n| --- | --- |\n| a | 1 |")
  })

  test("gives a header-less table an empty header, so it still renders", () => {
    expect(
      adfToMarkdown(
        doc({ type: "table", content: [row(cell("tableCell", "a"), cell("tableCell", "b"))] }),
      ),
    ).toBe("|  |  |\n| --- | --- |\n| a | b |")
  })

  test("flattens a cell to one line and escapes its pipes", () => {
    expect(
      adfToMarkdown(
        doc({
          type: "table",
          content: [
            row({
              type: "tableHeader",
              content: [paragraph(text("one")), paragraph(text("a | b"))],
            }),
          ],
        }),
      ),
    ).toBe("| one a \\| b |\n| --- |")
  })

  test("renders a panel as a blockquote", () => {
    expect(
      adfToMarkdown(
        doc({
          type: "panel",
          attrs: { panelType: "info" },
          content: [paragraph(text("Heads up."))],
        }),
      ),
    ).toBe("> Heads up.")
  })

  test("marks media as an attachment", () => {
    expect(
      adfToMarkdown(doc({ type: "mediaSingle", content: [{ type: "media", attrs: { id: "x" } }] })),
    ).toBe("[attachment]")
  })

  test("renders a mention as a handle", () => {
    expect(
      adfToMarkdown(
        doc(paragraph(text("cc "), { type: "mention", attrs: { id: "1", text: "@Ana Silva" } })),
      ),
    ).toBe("cc @Ana Silva")
  })

  test("renders an emoji as its text, falling back to its short name", () => {
    expect(
      adfToMarkdown(
        doc(
          paragraph(
            { type: "emoji", attrs: { shortName: ":smile:", text: "😄" } },
            { type: "emoji", attrs: { shortName: ":shipit:" } },
          ),
        ),
      ),
    ).toBe("😄:shipit:")
  })

  test("renders a card as a link", () => {
    expect(
      adfToMarkdown(
        doc(paragraph({ type: "inlineCard", attrs: { url: "https://example.test/a" } }), {
          type: "blockCard",
          attrs: { url: "https://example.test/b" },
        }),
      ),
    ).toBe("<https://example.test/a>\n\n<https://example.test/b>")
  })

  test("falls back to the text content of an unknown node", () => {
    expect(
      adfToMarkdown(doc({ type: "expand", content: [paragraph(text("Hidden detail."))] })),
    ).toBe("Hidden detail.")
  })
})
