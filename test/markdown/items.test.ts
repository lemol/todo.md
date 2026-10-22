import { describe, expect, test } from "bun:test"
import {
  escapeLinkText,
  formatHead,
  formatInlineItem,
  formatLinkedItem,
  parseHead,
  unescapeLinkText,
} from "../../src/markdown/items.ts"
import { noFields } from "../../src/markdown/metadata.ts"

describe("formatHead", () => {
  test("formats ID with zero-padding and title", () => {
    expect(formatHead("7", "Add rate limiting")).toBe("07 - Add rate limiting")
    expect(formatHead("123", "Large ID")).toBe("123 - Large ID")
  })
})

describe("parseHead", () => {
  test("splits at the first ' - ' after the ID", () => {
    expect(parseHead("07 - 2024 - budget review")).toEqual({
      id: "7",
      title: "2024 - budget review",
    })
  })

  test("has no ID without '<digits> - '", () => {
    expect(parseHead("Buy milk")).toEqual({ id: undefined, title: "Buy milk" })
    expect(parseHead("2024 budget")).toEqual({ id: undefined, title: "2024 budget" })
  })
})

describe("formatInlineItem", () => {
  test("writes the head, metadata line and indented description", () => {
    expect(
      formatInlineItem({
        id: "3",
        title: "Fix login redirect",
        fields: { ...noFields, tags: ["bug"], assignee: "lemol" },
        description: "Users land on /home.\n\n- check the referrer",
      }),
    ).toEqual([
      "- [ ] 03 - Fix login redirect",
      "  #bug @lemol",
      "  Users land on /home.",
      "",
      "  - check the referrer",
    ])
  })

  test("separates a description that would read as metadata with a blank line", () => {
    expect(
      formatInlineItem({ id: "3", title: "T", fields: noFields, description: "note:important" }),
    ).toEqual(["- [ ] 03 - T", "", "  note:important"])
  })

  for (const description of ["Body", "Body\n", "Body\n\n", "Body\n  \n"]) {
    test(`inline item excludes terminal blank lines: ${JSON.stringify(description)}`, () => {
      expect(formatInlineItem({ id: "3", title: "T", fields: noFields, description })).toEqual([
        "- [ ] 03 - T",
        "  Body",
      ])
    })
  }

  test("inline item preserves internal blank lines and Markdown hard breaks", () => {
    expect(
      formatInlineItem({
        id: "3",
        title: "T",
        fields: noFields,
        description: "Body  \nMore\n\nEnd\n",
      }),
    ).toEqual(["- [ ] 03 - T", "  Body  ", "  More", "", "  End"])
  })

  test("writes a checked box", () => {
    expect(
      formatInlineItem({ id: "3", title: "T", checked: true, fields: noFields, description: "" }),
    ).toEqual(["- [x] 03 - T"])
  })
})

describe("formatLinkedItem", () => {
  test("links to the file with ./ and escapes brackets in the title", () => {
    expect(
      formatLinkedItem({ id: "7", title: "Fix [x] bug", path: "backend/07-fix-x-bug.md" }),
    ).toEqual(["- [ ] [07 - Fix \\[x\\] bug](./backend/07-fix-x-bug.md)"])
  })

  test("writes a checked box when checked is true", () => {
    expect(
      formatLinkedItem({
        id: "7",
        title: "Done task",
        path: "backend/07-done.md",
        checked: true,
      }),
    ).toEqual(["- [x] [07 - Done task](./backend/07-done.md)"])
  })
})

test("escapeLinkText and unescapeLinkText round-trip", () => {
  expect(unescapeLinkText(escapeLinkText("a [b] \\ c"))).toBe("a [b] \\ c")
})
