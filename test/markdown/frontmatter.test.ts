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

  test("falls back to formatFrontmatter on invalid or flow-style YAML", () => {
    expect(setFrontmatterFields("unclosed: [a, b", { title: "New" })).toEqual(["title: New"])
    expect(setFrontmatterFields("{ a: 1, b: 2 }", { b: 3, c: 4 })).toEqual(["a: 1", "b: 3", "c: 4"])
  })

  test("replaces multiple simultaneous non-contiguous keys", () => {
    const input = [
      "key1: old1",
      "keep1: unchanged",
      "key2: old2",
      "keep2: unchanged",
      "key3: old3",
    ].join("\n")

    expect(setFrontmatterFields(input, { key1: "new1", key3: "new3" })).toEqual([
      "key1: new1",
      "keep1: unchanged",
      "key2: old2",
      "keep2: unchanged",
      "key3: new3",
    ])
  })
})
