import { describe, expect, test } from "bun:test"
import { DateTime } from "effect"
import {
  formatTaskFile,
  formatTimestamp,
  parseCommentHeading,
  parseTaskFile,
  prependComment,
  type TaskFileContent,
  updateTaskFile,
} from "../../src/markdown/taskFile.ts"
import { md } from "./fixtures.ts"

const utc = (iso: string) => DateTime.makeUnsafe(iso)

const example = md(
  "---",
  "title: Add rate limiting   # from the design review",
  "tags: [api, security]",
  "assignee: lemol",
  "depends_on: [3]",
  "estimate: 3",
  "---",
  "Token bucket per API key.",
  "",
  "## Design",
  "",
  "100 requests per minute.",
  "",
  "## Comments",
  "",
  "### @claude at 2026-09-12 12:00 +01:00",
  "",
  "Started. Open question:",
  "",
  "- [ ] per-key or per-IP?",
  "",
  "### @lemol at 2026-09-11 09:30",
  "",
  "Do this after the login fix.",
)

describe("parseTaskFile", () => {
  const file = parseTaskFile(example, "backend/07-add-rate-limiting.md")

  test("reads the standard frontmatter fields and keeps the rest as extra", () => {
    expect(file).toMatchObject({
      title: "Add rate limiting",
      tags: ["api", "security"],
      assignee: "lemol",
      dependsOn: ["3"],
      extra: { estimate: 3 },
      group: undefined,
      completedAt: undefined,
      diagnostics: [],
    })
  })

  test("reads the description up to the comments section", () => {
    expect(file.description).toBe(
      "Token bucket per API key.\n\n## Design\n\n100 requests per minute.",
    )
  })

  test("reads comments newest first, converting times to UTC", () => {
    expect(file.comments.map((c) => [c.author, DateTime.formatIso(c.at), c.body])).toEqual([
      ["claude", "2026-09-12T11:00:00.000Z", "Started. Open question:\n\n- [ ] per-key or per-IP?"],
      ["lemol", "2026-09-11T09:30:00.000Z", "Do this after the login fix."],
    ])
  })

  test("reads done-file fields", () => {
    const done = parseTaskFile(
      md("---", "title: Fix", "group: Backend", "completed_at: 2026-09-12T10:31:00Z", "---"),
      "f.md",
    )
    expect(done.group).toBe("Backend")
    expect(done.completedAt === undefined ? undefined : DateTime.formatIso(done.completedAt)).toBe(
      "2026-09-12T10:31:00.000Z",
    )
  })

  test("accepts a file without frontmatter", () => {
    expect(parseTaskFile("Just notes.\n", "f.md")).toMatchObject({
      title: undefined,
      description: "Just notes.",
      tags: [],
    })
  })

  test("reports invalid frontmatter fields and comment headings", () => {
    const broken = parseTaskFile(
      md(
        "---",
        "tags: {a: 1}",
        "depends_on: [x]",
        "completed_at: soon",
        "---",
        "## Comments",
        "",
        "### a note",
      ),
      "f.md",
    )
    expect(broken.diagnostics.map((d) => [d.code, d.line])).toEqual([
      ["invalid-frontmatter", 1],
      ["invalid-frontmatter", 1],
      ["invalid-frontmatter", 1],
      ["invalid-comment", 8],
    ])
    expect(broken.tags).toEqual([])
    expect(broken.dependsOn).toEqual([])
  })

  test("treats a Comments heading that is not the last level-2 heading as description", () => {
    const file = parseTaskFile(md("## Comments", "", "text", "", "## Later"), "f.md")
    expect(file.comments).toEqual([])
    expect(file.description).toBe("## Comments\n\ntext\n\n## Later")
  })

  test("reads a cancelled task's outcome and reason", () => {
    const cancelled = parseTaskFile(
      md(
        "---",
        "title: Drop this",
        "completed_at: 2026-09-18T19:13:18Z",
        "outcome: cancelled",
        "cancelled_reason: Superseded by d47fcd2.",
        "---",
      ),
      "f.md",
    )
    expect(cancelled.outcome).toBe("cancelled")
    expect(cancelled.cancelledReason).toBe("Superseded by d47fcd2.")
    expect(cancelled.extra).toEqual({})
    expect(cancelled.diagnostics).toEqual([])
  })

  test("an outcome the model does not define is invalid frontmatter", () => {
    const invalid = parseTaskFile(
      md("---", "title: T", "completed_at: 2026-09-18T19:13:18Z", "outcome: wontfix", "---"),
      "f.md",
    )
    expect(invalid.outcome).toBeUndefined()
    expect(invalid.diagnostics.map((d) => d.code)).toEqual(["invalid-frontmatter"])
  })
})

describe("timestamps", () => {
  test("formatTimestamp writes UTC with an offset, adding seconds only when needed", () => {
    expect(formatTimestamp(utc("2026-09-12T12:00:00Z"))).toBe("2026-09-12 12:00 +00:00")
    expect(formatTimestamp(utc("2026-09-12T12:00:30Z"))).toBe("2026-09-12 12:00:30 +00:00")
  })

  test("parseCommentHeading accepts T, seconds and a missing offset", () => {
    expect(parseCommentHeading("@a at 2026-09-12T12:00:30-05:00")?.at).toEqual(
      utc("2026-09-12T17:00:30Z"),
    )
    expect(parseCommentHeading("@a at 2026-09-12 12:00")?.at).toEqual(utc("2026-09-12T12:00:00Z"))
    expect(parseCommentHeading("a note")).toBeUndefined()
  })
})

const content: TaskFileContent = {
  title: "Fix login redirect",
  tags: ["bug"],
  assignee: "lemol",
  dependsOn: ["1"],
  extra: { estimate: 3 },
  description: "Users land on /home.",
  comments: [{ author: "lemol", at: utc("2026-09-12T12:00:00Z"), body: "Found it." }],
  group: "Backend",
  completedAt: utc("2026-09-12T10:31:00Z"),
  outcome: undefined,
  cancelledReason: undefined,
}

describe("formatTaskFile", () => {
  test("writes frontmatter in canonical order, the description and comments", () => {
    expect(formatTaskFile(content)).toBe(
      md(
        "---",
        "title: Fix login redirect",
        "tags: [bug]",
        "assignee: lemol",
        "depends_on: [1]",
        "estimate: 3",
        "group: Backend",
        "completed_at: 2026-09-12T10:31:00Z",
        "---",
        "Users land on /home.",
        "",
        "## Comments",
        "",
        "### @lemol at 2026-09-12 12:00 +00:00",
        "",
        "Found it.",
      ),
    )
  })

  test("writes only the title when that is all there is", () => {
    const minimal = {
      ...content,
      tags: [],
      assignee: undefined,
      dependsOn: [],
      extra: {},
      description: "",
      comments: [],
      group: undefined,
      completedAt: undefined,
    }
    expect(formatTaskFile(minimal)).toBe(md("---", "title: Fix login redirect", "---"))
  })

  test("round-trips through parseTaskFile", () => {
    const { diagnostics, ...parsed } = parseTaskFile(formatTaskFile(content), "f.md")
    expect(diagnostics).toEqual([])
    expect(parsed).toEqual(content)
  })

  test("writes the outcome and reason after completed_at", () => {
    const source = formatTaskFile({
      title: "Drop this",
      tags: [],
      assignee: undefined,
      dependsOn: [],
      extra: {},
      description: "",
      comments: [],
      group: undefined,
      completedAt: utc("2026-09-18T19:13:18Z"),
      outcome: "cancelled",
      cancelledReason: "Superseded by d47fcd2.",
    })
    expect(source).toContain("completed_at: 2026-09-18T19:13:18Z")
    expect(source).toContain("outcome: cancelled")
    expect(source).toContain("cancelled_reason: Superseded by d47fcd2.")
  })
})

describe("updateTaskFile", () => {
  test("rewrites only the changed frontmatter keys", () => {
    expect(updateTaskFile(example, { assignee: "claude", title: "Add rate limiting" })).toBe(
      example.replace("assignee: lemol", "assignee: claude"),
    )
  })

  test("removes fields set to null or emptied", () => {
    expect(updateTaskFile(example, { assignee: null, tags: [], dependsOn: [] })).toBe(
      example.replace("tags: [api, security]\nassignee: lemol\ndepends_on: [3]\n", ""),
    )
  })

  test("replaces extra fields as a whole", () => {
    expect(updateTaskFile(example, { extra: { size: "m" } })).toBe(
      example.replace("estimate: 3", "size: m"),
    )
  })

  test("replaces the description and keeps the comments", () => {
    const updated = updateTaskFile(example, { description: "New plan." })
    expect(updated).toBe(
      example.replace(
        "Token bucket per API key.\n\n## Design\n\n100 requests per minute.\n",
        "New plan.\n",
      ),
    )
  })

  test("records completion and clears it", () => {
    const done = updateTaskFile(example, {
      group: "Backend",
      completedAt: utc("2026-09-12T10:31:00Z"),
    })
    expect(done).toBe(
      example.replace(
        "estimate: 3\n",
        "estimate: 3\ngroup: Backend\ncompleted_at: 2026-09-12T10:31:00Z\n",
      ),
    )
    expect(updateTaskFile(done, { group: null, completedAt: null })).toBe(example)
  })

  test("adds frontmatter to a file without one", () => {
    expect(updateTaskFile("Notes.\n", { title: "Notes" })).toBe(
      md("---", "title: Notes", "---", "Notes."),
    )
  })

  test("changes nothing when nothing changes", () => {
    expect(updateTaskFile(example, { title: "Add rate limiting", tags: ["api", "security"] })).toBe(
      example,
    )
  })
})

describe("prependComment", () => {
  const comment = { author: "claude", at: utc("2026-09-13T08:00:00Z"), body: "Done." }

  test("adds the comment at the top of the comments section", () => {
    expect(prependComment(example, comment)).toBe(
      example.replace(
        "## Comments\n\n",
        "## Comments\n\n### @claude at 2026-09-13 08:00 +00:00\n\nDone.\n\n",
      ),
    )
  })

  test("creates the comments section at the end of the file", () => {
    expect(prependComment(md("---", "title: T", "---", "Notes.", ""), comment)).toBe(
      md(
        "---",
        "title: T",
        "---",
        "Notes.",
        "",
        "## Comments",
        "",
        "### @claude at 2026-09-13 08:00 +00:00",
        "",
        "Done.",
      ),
    )
  })
})
