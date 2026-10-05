import { describe, expect, test } from "bun:test"
import {
  fitsMetadataLine,
  formatMetadataLine,
  noFields,
  parseMetadataLine,
} from "../../src/markdown/metadata.ts"

describe("parseMetadataLine", () => {
  test("reads tags, assignee, dependencies and extra fields", () => {
    expect(parseMetadataLine("#bug #year1 @lemol depends_on:01,2 estimate:3 ready:true")).toEqual({
      fields: {
        tags: ["bug", "year1"],
        assignee: "lemol",
        dependsOn: ["1", "2"],
        extra: { estimate: 3, ready: true },
      },
      diagnostics: [],
    })
  })

  test("splits tokens at a comma followed by # or @", () => {
    expect(parseMetadataLine("#bug,#year1,@lemol")?.fields).toMatchObject({
      tags: ["bug", "year1"],
      assignee: "lemol",
    })
  })

  test("accepts tags: and assignee: as equivalent forms", () => {
    expect(parseMetadataLine("tags:a,b assignee:lemol")?.fields).toMatchObject({
      tags: ["a", "b"],
      assignee: "lemol",
    })
  })

  test("returns undefined unless every token is metadata", () => {
    expect(parseMetadataLine("Users land on /home")).toBeUndefined()
    expect(parseMetadataLine("#bug and more")).toBeUndefined()
    expect(parseMetadataLine("https://example.com/issue/3")).toBeUndefined()
    expect(parseMetadataLine("see:/docs")).toBeUndefined()
    expect(parseMetadataLine("")).toBeUndefined()
  })

  test("reports reserved fields, several assignees and invalid dependencies", () => {
    const parsed = parseMetadataLine("title:x @a @b depends_on:x")
    expect(parsed?.diagnostics.map((d) => d.code)).toEqual([
      "reserved-field",
      "invalid-metadata",
      "multiple-assignees",
    ])
    expect(parsed?.fields.assignee).toBe("a")
    expect(parsed?.fields.dependsOn).toEqual([])
    expect(parsed?.fields.extra).toEqual({})
  })

  test("reports outcome and cancelled_reason as reserved fields", () => {
    const parsed = parseMetadataLine("outcome:cancelled cancelled_reason:x")
    expect(parsed?.diagnostics.map((d) => d.code)).toEqual(["reserved-field", "reserved-field"])
    expect(parsed?.fields.extra).toEqual({})
  })

  test("accepts qualified foreign task IDs in depends_on", () => {
    const parsed = parseMetadataLine("#bug depends_on:1,slash-usage:2,work:PROJ-7")
    expect(parsed?.fields.dependsOn).toEqual(["1", "slash-usage:2", "work:PROJ-7"])
    expect(parsed?.diagnostics).toEqual([])
  })
})

describe("formatMetadataLine", () => {
  test("writes #tags, @assignee, depends_on and extra fields", () => {
    const fields = {
      tags: ["bug"],
      assignee: "lemol",
      dependsOn: ["1", "2"],
      extra: { estimate: 3, size: "m" },
    }
    const line = formatMetadataLine(fields)
    expect(line).toBe("#bug @lemol depends_on:1,2 estimate:3 size:m")
    expect(parseMetadataLine(line)?.fields).toEqual(fields)
  })

  test("writes nothing for empty fields", () => {
    expect(formatMetadataLine(noFields)).toBe("")
  })
})

describe("fitsMetadataLine", () => {
  test("accepts single-token values", () => {
    expect(fitsMetadataLine({ ...noFields, tags: ["api/v2"], extra: { estimate: 3 } })).toBe(true)
  })

  test.each([
    ["a tag with a space", { ...noFields, tags: ["needs review"] }],
    ["an assignee with a space", { ...noFields, assignee: "Leza M" }],
    ["a string that reads back as a number", { ...noFields, extra: { code: "3" } }],
    ["a nested value", { ...noFields, extra: { links: ["a", "b"] } }],
    ["a value starting with /", { ...noFields, extra: { path: "/docs" } }],
    ["a reserved key", { ...noFields, extra: { group: "x" } }],
    ["a reserved key outcome", { ...noFields, extra: { outcome: "cancelled" } }],
    ["a reserved key cancelled_reason", { ...noFields, extra: { cancelled_reason: "x" } }],
    ["a standard key tags in extra", { ...noFields, extra: { tags: "x" } }],
    ["a standard key assignee in extra", { ...noFields, extra: { assignee: "x" } }],
    ["a standard key depends_on in extra", { ...noFields, extra: { depends_on: "1" } }],
  ])("rejects %s", (_label, fields) => {
    expect(fitsMetadataLine(fields)).toBe(false)
  })
})
