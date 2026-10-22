import { describe, expect, test } from "bun:test"
import {
  formatTodoFile,
  insertItem,
  parseTodoFile,
  removeItem,
  renameSection,
  replaceItem,
  setItemHead,
} from "../../src/markdown/todoFile.ts"
import { example, itemOf, md } from "./fixtures.ts"

describe("insertItem", () => {
  const todo = parseTodoFile(example)

  test("appends to the end of a group", () => {
    expect(insertItem(todo, "Backend", 3, ["- [ ] 15 - New"])).toBe(
      example.replace("* [X] 09 - Bump deps\n", "* [X] 09 - Bump deps\n- [ ] 15 - New\n"),
    )
  })

  test("inserts before the task at the index", () => {
    expect(insertItem(todo, "Backend", 1, ["- [ ] 15 - New"])).toBe(
      example.replace("- [ ] 03 - Fix", "- [ ] 15 - New\n- [ ] 03 - Fix"),
    )
  })

  test("adds the first task of a group after its description", () => {
    const text = md("# T", "", "## A", "", "Notes.", "", "## B")

    expect(insertItem(parseTodoFile(text), "A", 0, ["- [ ] 01 - New"])).toBe(
      md("# T", "", "## A", "", "Notes.", "", "- [ ] 01 - New", "", "## B"),
    )
  })

  test("adds the first task under a bare heading", () => {
    expect(insertItem(parseTodoFile(md("## A", "## B")), "A", 0, ["- [ ] 01 - New"])).toBe(
      md("## A", "", "- [ ] 01 - New", "", "## B"),
    )
  })

  test("appends a missing group at the end of the file", () => {
    expect(
      insertItem(parseTodoFile(md("# T", "", "- [ ] 01 - A", "", "")), "Later", 0, [
        "- [ ] 02 - B",
      ]),
    ).toBe(md("# T", "", "- [ ] 01 - A", "", "## Later", "", "- [ ] 02 - B"))
  })

  test("adds the first ungrouped task below the title", () => {
    expect(insertItem(parseTodoFile(md("# T")), undefined, 0, ["- [ ] 01 - A"])).toBe(
      md("# T", "", "- [ ] 01 - A"),
    )
    expect(insertItem(parseTodoFile(""), undefined, 0, ["- [ ] 01 - A"])).toBe(md("- [ ] 01 - A"))
  })

  test("keeps CRLF line endings", () => {
    const crlf = "# T\r\n\r\n- [ ] 01 - A\r\n"

    expect(insertItem(parseTodoFile(crlf), undefined, 1, ["- [ ] 02 - B"])).toBe(
      `${crlf}- [ ] 02 - B\r\n`,
    )
  })
})

describe("removeItem", () => {
  test("removes an item with its body", () => {
    const todo = parseTodoFile(example)

    expect(removeItem(todo, itemOf(todo, "3"))).toBe(
      example.replace(
        "- [ ] 03 - Fix login redirect\n  #bug @lemol depends_on:1\n  Users land on /home instead of the page they requested.\n\n  - check the referrer\n",
        "",
      ),
    )
  })

  test("does not leave a doubled blank line", () => {
    const todo = parseTodoFile(md("## A", "", "- [ ] 01 - A", "", "## B"))

    expect(removeItem(todo, itemOf(todo, "1"))).toBe(md("## A", "", "## B"))
  })

  test("does not leave a blank line at the end of the file", () => {
    const todo = parseTodoFile(md("# T", "", "- [ ] 01 - A"))

    expect(removeItem(todo, itemOf(todo, "1"))).toBe(md("# T"))
  })
})

describe("replaceItem and setItemHead", () => {
  test("replaceItem swaps an item's lines", () => {
    const todo = parseTodoFile(example)

    expect(
      replaceItem(todo, itemOf(todo, "14"), [
        "- [ ] [14 - Write changelog](./14-write-changelog.md)",
      ]),
    ).toBe(
      example.replace(
        "- [ ] 14 - Write changelog",
        "- [ ] [14 - Write changelog](./14-write-changelog.md)",
      ),
    )
  })

  test("setItemHead keeps the bullet, checkbox, body and link target", () => {
    const todo = parseTodoFile(example)
    const renamed = setItemHead(todo, itemOf(todo, "9"), "9", "Bump all deps")

    expect(renamed).toBe(example.replace("* [X] 09 - Bump deps", "* [X] 09 - Bump all deps"))
    const linked = parseTodoFile(md("- [ ] [Rate limits](backend/x.md)"))
    const [first] = linked.sections[0]?.items ?? []

    if (first === undefined) throw new Error("no item")

    expect(setItemHead(linked, first, "7", "Add rate limiting")).toBe(
      md("- [ ] [07 - Add rate limiting](backend/x.md)"),
    )
  })
})

describe("renameSection", () => {
  test("rewrites only the heading's name", () => {
    expect(renameSection(parseTodoFile(example), "Frontend", "Web")).toBe(
      example.replace("## Frontend ##", "## Web ##"),
    )
  })
})

test("formatTodoFile writes a title and optional description", () => {
  expect(formatTodoFile({ title: "Acme API" })).toBe("# Acme API\n")
  expect(formatTodoFile({ title: "Acme API", description: "Backlog." })).toBe(
    "# Acme API\n\nBacklog.\n",
  )
})

describe("lone carriage returns", () => {
  const source = "# L\n\n## Now\n\n- [ ] one\rstill one\n- [ ] [two](02-two.md)\n- [ ] three\n"
  const todo = parseTodoFile(source)
  const [one, two, three] = todo.sections[1]?.items ?? []

  test("parseTodoFile reads every item at its own lines", () => {
    expect(
      todo.sections[1]?.items.map(({ title, start, end, linked, description }) => ({
        title,
        start,
        end,
        linked,
        description,
      })),
    ).toEqual([
      { title: "one", start: 4, end: 6, linked: false, description: "still one" },
      { title: "two", start: 6, end: 7, linked: true, description: "" },
      { title: "three", start: 7, end: 8, linked: false, description: "" },
    ])
  })

  test("removeItem removes exactly one item and keeps the lone CR elsewhere", () => {
    if (one === undefined || two === undefined) throw new Error("missing items")

    expect(removeItem(todo, one)).toBe("# L\n\n## Now\n\n- [ ] [two](02-two.md)\n- [ ] three\n")
    expect(removeItem(todo, two)).toBe("# L\n\n## Now\n\n- [ ] one\rstill one\n- [ ] three\n")
  })

  test("insertItem and setItemHead edit only their own lines", () => {
    if (two === undefined || three === undefined) throw new Error("missing items")

    expect(insertItem(todo, "Now", 1, ["- [ ] new"])).toBe(
      "# L\n\n## Now\n\n- [ ] one\rstill one\n- [ ] new\n- [ ] [two](02-two.md)\n- [ ] three\n",
    )
    expect(setItemHead(todo, two, "2", "two")).toBe(
      "# L\n\n## Now\n\n- [ ] one\rstill one\n- [ ] [02 - two](02-two.md)\n- [ ] three\n",
    )
    expect(setItemHead(todo, three, "3", "three")).toBe(
      "# L\n\n## Now\n\n- [ ] one\rstill one\n- [ ] [two](02-two.md)\n- [ ] 03 - three\n",
    )
  })
})
