import { describe, expect, test } from "bun:test"
import {
  formatFrontmatter,
  frontmatterEdits,
  readFrontmatter,
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

  test("reports aliases that do not resolve, and reads ones that do", () => {
    expect(readFrontmatter("title: T\nx: *a")).toEqual({
      data: {},
      error: "Unresolved alias (the anchor must be set before the alias): a",
    })
    expect(readFrontmatter("a: &x 1\nb: *x")).toEqual({ data: { a: 1, b: 1 }, error: undefined })
  })

  test("reports an alias bomb", () => {
    const bomb = [
      "a: &a [x, x, x, x, x, x, x, x, x, x]",
      "b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]",
      "c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]",
      "d: &d [*c, *c, *c, *c, *c, *c, *c, *c, *c, *c]",
      "e: [*d, *d, *d, *d, *d, *d, *d, *d, *d, *d]",
    ].join("\n")

    expect(readFrontmatter(bomb)).toEqual({
      data: {},
      error: "Excessive alias count indicates a resource exhaustion attack",
    })
  })

  test("treats empty frontmatter as no fields", () => {
    expect(readFrontmatter("")).toEqual({ data: {}, error: undefined })
  })

  test("reports invalid YAML and non-mappings", () => {
    expect(readFrontmatter("a: [unclosed").error).toBeString()
    expect(readFrontmatter("- a").error).toBe("frontmatter must be a mapping")
  })

  test("diagnostics stop at every line ending", () => {
    expect(readFrontmatter('a: "\\\rX"\r\nb: 1').error).toBe("Invalid escape sequence \\")
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

describe("frontmatterEdits", () => {
  test("splices keys of YAML whose aliases do not resolve, leaving the other lines", () => {
    const unresolved = ["title: T", "assignee: z", "x: *a"].join("\n")

    expect(frontmatterEdits(unresolved, { assignee: undefined, estimate: 3 })).toEqual([
      { start: 3, deleteCount: 0, lines: ["estimate: 3"] },
      { start: 1, deleteCount: 1, lines: [] },
    ])
  })

  test("leaves flow-map frontmatter whose aliases do not resolve as it is", () => {
    expect(frontmatterEdits("{title: T, x: *a}", { assignee: "y" })).toEqual([])
  })

  test("rewrites only the changed key", () => {
    expect(frontmatterEdits(yaml, { assignee: "claude", title: "Add rate limiting" })).toEqual([
      { start: 2, deleteCount: 1, lines: ["assignee: claude"] },
    ])
  })

  test("deletes keys set to undefined and appends new keys", () => {
    expect(frontmatterEdits(yaml, { tags: undefined, estimate: 3 })).toEqual([
      { start: 3, deleteCount: 0, lines: ["estimate: 3"] },
      { start: 1, deleteCount: 1, lines: [] },
    ])
  })

  test("replaces a multi-line value", () => {
    const block = ["tags:", "  - api", "  - security", "title: X"].join("\n")

    expect(frontmatterEdits(block, { tags: ["bug"] })).toEqual([
      { start: 0, deleteCount: 3, lines: ["tags: [bug]"] },
    ])
  })

  test("adds keys to empty frontmatter", () => {
    expect(frontmatterEdits("", { title: "X" })).toEqual([
      { start: 0, deleteCount: 0, lines: ["title: X"] },
    ])
  })

  test("falls back to formatFrontmatter on invalid or flow-style YAML", () => {
    expect(frontmatterEdits("unclosed: [a, b", { title: "New" })).toEqual([
      { start: 0, deleteCount: 1, lines: ["title: New"] },
    ])
    expect(frontmatterEdits("{ a: 1, b: 2 }", { b: 3, c: 4 })).toEqual([
      { start: 0, deleteCount: 1, lines: ["a: 1", "b: 3", "c: 4"] },
    ])
  })

  test("replaces multiple simultaneous non-contiguous keys", () => {
    const input = [
      "key1: old1",
      "keep1: unchanged",
      "key2: old2",
      "keep2: unchanged",
      "key3: old3",
    ].join("\n")

    expect(frontmatterEdits(input, { key1: "new1", key3: "new3" })).toEqual([
      { start: 4, deleteCount: 1, lines: ["key3: new3"] },
      { start: 0, deleteCount: 1, lines: ["key1: new1"] },
    ])
  })

  test("keeps YAML ranges aligned after a multiline CRLF value", () => {
    expect(
      frontmatterEdits("title: |\r\n  T\r\ntags: [a]\r\nestimate: 3", { tags: ["b"] }),
    ).toEqual([{ start: 2, deleteCount: 1, lines: ["tags: [b]"] }])
  })

  test("counts a lone CR as a line ending, as the Markdown parser does", () => {
    expect(frontmatterEdits('title: "a\rb"\r\ntags: [a]', { tags: ["b"] })).toEqual([
      { start: 2, deleteCount: 1, lines: ["tags: [b]"] },
    ])
    expect(frontmatterEdits('title: "a\rb"\ntags: [a]', { title: "c" })).toEqual([
      { start: 0, deleteCount: 2, lines: ["title: c"] },
    ])
  })

  test("reads YAML that breaks keys on a lone CR by those lines", () => {
    expect(frontmatterEdits("title: T\rtags: [a]", { tags: ["b"] })).toEqual([
      { start: 1, deleteCount: 1, lines: ["tags: [b]"] },
    ])
  })
})
