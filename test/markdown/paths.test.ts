import { describe, expect, test } from "bun:test"
import {
  basename,
  dirname,
  groupSlug,
  joinPath,
  linkTarget,
  normalizePath,
  resolveLink,
  slug,
  taskPath,
} from "../../src/markdown/paths.ts"

describe("normalizePath", () => {
  test("resolves . and .. inside the root", () => {
    expect(normalizePath("./backend/../07-x.md")).toBe("07-x.md")
    expect(normalizePath("a//b/./c")).toBe("a/b/c")
  })

  test("rejects paths that leave the root, absolute paths and URLs", () => {
    expect(normalizePath("../x.md")).toBeUndefined()
    expect(normalizePath("/etc/passwd")).toBeUndefined()
    expect(normalizePath("https://example.com/x.md")).toBeUndefined()
  })
})

describe("links", () => {
  test("resolveLink decodes percent-encoding and rejects escapes", () => {
    expect(resolveLink("./backend/07%20add.md")).toBe("backend/07 add.md")
    expect(resolveLink("../outside.md")).toBeUndefined()
    expect(resolveLink("./")).toBeUndefined()
  })

  test("linkTarget adds ./ and angle brackets when needed", () => {
    expect(linkTarget("backend/07-x.md")).toBe("./backend/07-x.md")
    expect(linkTarget("notes/my task.md")).toBe("<./notes/my task.md>")
  })

  test("joinPath, basename and dirname", () => {
    expect(joinPath(".", "backend", "07-x.md")).toBe("backend/07-x.md")
    expect(joinPath("", "backend")).toBe("backend")
    expect(basename("backend/07-x.md")).toBe("07-x.md")
    expect(dirname("backend/07-x.md")).toBe("backend")
    expect(dirname("07-x.md")).toBe("")
  })
})

describe("groupSlug", () => {
  test("slugs a group name with fallback to group", () => {
    expect(groupSlug("Backend")).toBe("backend")
    expect(groupSlug("API & Auth")).toBe("api-auth")
    expect(groupSlug("")).toBe("group")
    expect(groupSlug("!!!")).toBe("group")
  })
})

describe("slug", () => {
  test("lowercases, strips accents and joins words with -", () => {
    expect(slug("Add rate limiting", "task")).toBe("add-rate-limiting")
    expect(slug("API & Auth", "group")).toBe("api-auth")
    expect(slug("Ação rápida!", "task")).toBe("acao-rapida")
  })

  test("falls back when nothing is left", () => {
    expect(slug("タスク", "task")).toBe("task")
    expect(slug("!!!", "group")).toBe("group")
  })

  test("cuts long slugs at a word boundary within 60 characters", () => {
    const long = slug("word ".repeat(30), "task")

    expect(long.length).toBeLessThanOrEqual(60)
    expect(long.endsWith("-")).toBe(false)
    expect(long).toBe(Array(12).fill("word").join("-"))
  })
})

describe("taskPath", () => {
  test("puts grouped tasks in the group's directory", () => {
    expect(taskPath(".", "Backend", "7", "Add rate limiting")).toBe(
      "backend/07-add-rate-limiting.md",
    )
    expect(taskPath("done", "API & Auth", "3", "Fix login")).toBe("done/api-auth/03-fix-login.md")
    expect(taskPath("tasks", undefined, "14", "Write changelog")).toBe(
      "tasks/14-write-changelog.md",
    )
  })
})
