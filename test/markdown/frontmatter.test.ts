import { describe, expect, test } from "bun:test"
import {
  formatFrontmatter,
  readFrontmatter,
  setFrontmatterFields,
} from "../../src/markdown/frontmatter.ts"

const yaml = [
  "title: Add rate limiting   # keep me",
  "tags: [api, security]",
  "assignee: lemol",
].join("\n")

describe("readFrontmatter", () => {
  test("reads a mapping", () => {
    expect(readFrontmatter(yaml)).toEqual({
      data: { title: "Add rate limiting", tags: ["api", "security"], assignee: "lemol" },
      error: undefined,
    })
  })

  test("treats empty frontmatter as no fields", () => {
    expect(readFrontmatter("")).toEqual({ data: {}, error: undefined })
  })

  test("reports invalid YAML and non-mappings", () => {
    expect(readFrontmatter("a: [unclosed").error).toBeString()
    expect(readFrontmatter("- a").error).toBe("frontmatter must be a mapping")
  })
})

describe("formatFrontmatter", () => {
  test("writes fields in order, with flow-style lists", () => {
    expect(
      formatFrontmatter([
        ["title", "Fix: login"],
        ["tags", ["bug"]],
        ["depends_on", [1, 2]],
        ["completed_at", "2026-09-12T10:31:00Z"],
      ]),
    ).toEqual([
      'title: "Fix: login"',
      "tags: [bug]",
      "depends_on: [1, 2]",
      "completed_at: 2026-09-12T10:31:00Z",
    ])
  })
})

describe("setFrontmatterFields", () => {
  test("rewrites only the changed key", () => {
    expect(setFrontmatterFields(yaml, { assignee: "claude", title: "Add rate limiting" })).toEqual([
      "title: Add rate limiting   # keep me",
      "tags: [api, security]",
      "assignee: claude",
    ])
  })

  test("deletes keys set to undefined and appends new keys", () => {
    expect(setFrontmatterFields(yaml, { tags: undefined, estimate: 3 })).toEqual([
      "title: Add rate limiting   # keep me",
      "assignee: lemol",
      "estimate: 3",
    ])
  })

  test("replaces a multi-line value", () => {
    const block = ["tags:", "  - api", "  - security", "title: X"].join("\n")
    expect(setFrontmatterFields(block, { tags: ["bug"] })).toEqual(["tags: [bug]", "title: X"])
  })

  test("adds keys to empty frontmatter", () => {
    expect(setFrontmatterFields("", { title: "X" })).toEqual(["title: X"])
  })
})
