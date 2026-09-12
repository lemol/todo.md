import { describe, expect, test } from "bun:test"
import { normalize, staleLinkText } from "../../src/markdown/normalize.ts"
import { findItem, parseTodoFile } from "../../src/markdown/todoFile.ts"
import { md } from "./fixtures.ts"

describe("normalize", () => {
  test("assigns IDs in document order after every used ID", () => {
    const todo = parseTodoFile(
      md(
        "- [ ] 03 - A",
        "- [ ] Buy milk",
        "* [ ] 07 - B",
        "- [x] [Rate limits](./notes/limits.md)",
      ),
    )
    const result = normalize(todo, { usedIds: ["12"], titles: new Map() })
    expect(result.assigned).toEqual(["13", "14"])
    expect(result.text).toBe(
      md(
        "- [ ] 03 - A",
        "- [ ] 13 - Buy milk",
        "* [ ] 07 - B",
        "- [x] [14 - Rate limits](./notes/limits.md)",
      ),
    )
    expect(result.checked).toEqual(["14"])
  })

  test("records checked items that already had IDs", () => {
    const todo = parseTodoFile(md("- [x] 03 - A", "- [ ] 04 - B"))
    const result = normalize(todo, { usedIds: [], titles: new Map() })
    expect(result.assigned).toEqual([])
    expect(result.checked).toEqual(["3"])
  })

  test("syncs link text with task file titles", () => {
    const todo = parseTodoFile(md("- [ ] [07 - Old title](./07-add-rate-limiting.md)"))
    const titles = new Map([["07-add-rate-limiting.md", "Add rate limiting"]])
    expect(normalize(todo, { usedIds: [], titles }).text).toBe(
      md("- [ ] [07 - Add rate limiting](./07-add-rate-limiting.md)"),
    )
  })

  test("leaves a normalized list untouched", () => {
    const text = md("# T", "", "* [ ] 3 - Kept as written", "  #tag")
    const result = normalize(parseTodoFile(text), { usedIds: [], titles: new Map() })
    expect(result).toEqual({ text, assigned: [], checked: [] })
  })
})

describe("staleLinkText", () => {
  test("reports link text that differs from the title", () => {
    const todo = parseTodoFile(md("# T", "", "- [ ] [07 - Old](./07-x.md)"))
    const item = findItem(todo, "7")
    if (item === undefined) throw new Error("no item")
    expect(staleLinkText(item, "New")).toMatchObject({
      code: "stale-link-text",
      taskId: "7",
      line: 3,
    })
    expect(staleLinkText(item, "Old")).toBeUndefined()
  })

  test("returns undefined for inline items or items without ID", () => {
    const todo = parseTodoFile(md("- [ ] 01 - Inline", "- [ ] [No ID](./x.md)"))
    const inline = findItem(todo, "1")
    if (inline === undefined) throw new Error("no item")
    expect(staleLinkText(inline, "Different")).toBeUndefined()

    const noId = todo.sections[0]?.items[1]
    if (noId === undefined) throw new Error("no item")
    expect(staleLinkText(noId, "Different")).toBeUndefined()
  })
})
