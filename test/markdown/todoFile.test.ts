import { describe, expect, test } from "bun:test"
import { parseTodoFile } from "../../src/markdown/todoFile.ts"
import { example, itemOf, md } from "./fixtures.ts"

describe("parseTodoFile", () => {
  const todo = parseTodoFile(example)

  test("reads configuration, title and description", () => {
    expect(todo.config).toEqual({ tasksDir: ".", doneDir: "archive" })
    expect(todo.title).toBe("Acme API")
    expect(todo.description).toBe("Backlog for the Acme API.")
  })

  test("reads sections in order, with their descriptions and items", () => {
    expect(
      todo.sections.map((section) => [
        section.name,
        section.description,
        section.items.map((i) => i.id),
      ]),
    ).toEqual([
      [undefined, "Backlog for the Acme API.", ["14"]],
      ["Backend", "Server-side work.", ["7", "3", "9"]],
      ["Frontend", "", []],
    ])
  })

  test("reads a linked item", () => {
    expect(itemOf(todo, "7")).toMatchObject({
      linked: true,
      title: "Add rate limiting",
      path: "backend/07-add-rate-limiting.md",
      checked: false,
    })
  })

  test("reads an inline item's metadata and de-indented description", () => {
    expect(itemOf(todo, "3")).toMatchObject({
      linked: false,
      title: "Fix login redirect",
      fields: { tags: ["bug"], assignee: "lemol", dependsOn: ["1"], extra: {} },
      description:
        "Users land on /home instead of the page they requested.\n\n- check the referrer",
    })
  })

  test("accepts other bullets and [X]", () => {
    expect(itemOf(todo, "9")).toMatchObject({ checked: true, title: "Bump deps" })
  })

  test("reports checked items", () => {
    expect(todo.diagnostics).toEqual([
      {
        severity: "info",
        code: "checked-item",
        message: '"Bump deps" is checked and will move to done',
        taskId: "9",
        file: "TODO.md",
        line: 23,
      },
    ])
  })

  test("ignores code blocks, level-3 headings and plain list items", () => {
    const parsed = parseTodoFile(
      md(
        "# T",
        "",
        "```",
        "## Not a group",
        "- [ ] 01 - Not a task",
        "```",
        "",
        "### Notes",
        "",
        "- plain",
        "- [ ] 02 - Task",
      ),
    )

    expect(parsed.sections.map((section) => section.name)).toEqual([undefined])
    expect(parsed.sections[0]?.items.map((i) => i.id)).toEqual(["2"])
  })

  test("requires a space after the checkbox, as GFM does", () => {
    const parsed = parseTodoFile(md("- [x]text", "- [ ] 01 - Task"))

    expect(parsed.sections[0]?.items.map((i) => i.id)).toEqual(["1"])
  })

  test("reads a metadata line only when it directly follows the item", () => {
    const parsed = parseTodoFile(md("- [ ] 01 - T", "", "  #not-metadata"))

    expect(itemOf(parsed, "1")).toMatchObject({
      fields: { tags: [] },
      description: "#not-metadata",
    })
  })

  test("reports items without an ID", () => {
    const parsed = parseTodoFile(md("# T", "", "- [ ] Buy milk"))

    expect(parsed.sections[0]?.items[0]).toMatchObject({ id: undefined, title: "Buy milk" })
    expect(parsed.diagnostics.map((d) => [d.code, d.line])).toEqual([["missing-id", 3]])
  })

  test("reports problems with links", () => {
    const parsed = parseTodoFile(
      md(
        "- [ ] [01 - Outside](../x.md)",
        "- [ ] [02 - Mismatch](./05-mismatch.md)",
        "- [ ] [03 - Body](./03-body.md)",
        "  stray text",
      ),
    )

    expect(parsed.diagnostics.map((d) => [d.code, d.severity, d.line])).toEqual([
      ["outside-root", "error", 1],
      ["id-mismatch", "warning", 2],
      ["linked-body", "warning", 3],
    ])
    expect(itemOf(parsed, "1").path).toBeUndefined()
  })

  test("unescapes link text and decodes angle-bracket targets", () => {
    const parsed = parseTodoFile(md("- [ ] [01 - Fix \\[x\\] bug](<./my task.md>)"))

    expect(itemOf(parsed, "1")).toMatchObject({ title: "Fix [x] bug", path: "my task.md" })
  })

  test("reports metadata problems on the metadata line", () => {
    const parsed = parseTodoFile(md("# T", "", "- [ ] 01 - T", "  @a @b"))

    expect(parsed.diagnostics).toEqual([
      {
        severity: "error",
        code: "multiple-assignees",
        message: "more than one assignee: a, b",
        taskId: "1",
        file: "TODO.md",
        line: 4,
      },
    ])
  })

  test("reports duplicate groups by name or slug", () => {
    const parsed = parseTodoFile(md("## API & Auth", "", "## API Auth"))

    expect(parsed.diagnostics.map((d) => [d.code, d.line])).toEqual([["duplicate-group", 3]])
  })

  test("reports invalid configuration and keeps the defaults", () => {
    const parsed = parseTodoFile(md("---", "tasks_dir: ../elsewhere", "---", "# T"))

    expect(parsed.config).toEqual({ tasksDir: ".", doneDir: "done" })
    expect(parsed.diagnostics.map((d) => d.code)).toEqual(["invalid-frontmatter"])
  })
})
