# markdown Module Implementation Plan (Plan 2 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `@lemol/todo-md/markdown`, the pure parser and minimal-diff writer for the todo.md file format (`TODO.md` and task files). The `fs` adapter (Plan 3) builds on it.

**Architecture:**
- **Reading:** `mdast-util-from-markdown` (with the GFM task-list and frontmatter extensions) finds the structure and each node's line range, following CommonMark rules. Titles, metadata and descriptions are then read from the source lines.
- **Writing:** every edit replaces a line range and returns the new text, so only the lines an operation touches change. Frontmatter edits rewrite only the lines of keys whose value changes.
- **Purity:** the module does no I/O. It converts between the format and the `spec` model, and does the text-only steps of normalization.

**Tech Stack:** Bun 1.4, TypeScript 7, Effect `4.0.0-rc.108` (`DateTime`, `Option`), `mdast-util-from-markdown` 2, `mdast-util-frontmatter`, `mdast-util-gfm-task-list-item`, the matching `micromark-extension-*`, `yaml` 2, `bun:test`, Biome.

**Spec:**
- [`docs/spec.md`](../../spec.md) Part 2 (§2.1–§2.13): what this plan implements.
- [`docs/architecture.md`](../../architecture.md): module rules.
- [`src/markdown/README.md`](../../../src/markdown/README.md): this module's contents.
- Plan 1 ([`2026-09-12-spec-module.md`](./2026-09-12-spec-module.md)) built the model this plan converts to.

**Where this plan sits:**

1. `spec` (done)
2. `markdown` (this plan)
3. `fs`
4. `core`
5. `cli`

## Global Constraints

- **Dependencies.** All are already in `package.json`; do not add any.
- **Read the Effect guide first.** Before writing Effect code, read `node_modules/effect/AGENTS.md`.
- **No I/O.** `src/markdown/**` may import only:
  - its own files;
  - `../spec/index.ts`;
  - `effect`;
  - `mdast` (types only);
  - `mdast-util-from-markdown`, `mdast-util-frontmatter`, `mdast-util-gfm-task-list-item`;
  - `micromark-extension-frontmatter`, `micromark-extension-gfm-task-list-item`;
  - `yaml`.

  No `node:*`, no `bun`; `test/boundaries.test.ts` enforces this. Paths are handled with the module's own posix helpers.
- **Imports.** Imports inside `src/` are relative and end in `.ts`.
- **Minimal diffs** (spec §2.10). An edit changes only the lines it is about. Tests state the whole expected output, so they also prove nothing else changed.
- **Tests** live in `test/markdown/` and use `bun:test`. `test/markdown/fixtures.ts` holds shared text fixtures.
- **Formatting.** Biome: double quotes, no semicolons, 2-space indent, line width 100. Run `bun run fix` after editing; code in this plan is already formatted.
- **Gate.** `bun run check` must pass before every commit.
- **Commits.** Commit messages are plain sentences ending with:

  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_014ak6bnNqeftYod6YDrWkcK
  ```

## Decisions this plan makes

Task 9 writes each of these into the spec.

- **Slugs** use ASCII letters and digits only (`タスク` → `task`), for portable file names (§2.8).
- **Empty headings and items.** A `##` heading with no text is content, not a group. A checkbox must be followed by a space (as in GFM), and an item with no text is content (§2.3, §2.4).
- **`invalid-comment`** (error) is a new diagnostic: a `###` heading in the comments section that isn't `@author at <timestamp>` (§2.6, §2.12).
- **Timestamps.** Writers write comment times in UTC (`2026-09-12 12:00 +00:00`), adding `:ss` only when seconds are not zero. `completed_at` is written as `2026-09-12T10:31:00Z`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/markdown/lines.ts` | `Lines` (text as lines plus EOL style), `splitLines`, `joinLines`, `spliceLines`, `isBlank`, `trimBlock` |
| `src/markdown/ids.ts` | `isId`, `parseId`, `formatId`, `nextId` (spec §2.7) |
| `src/markdown/paths.ts` | Posix path helpers, `slug`, `groupSlug`, `taskPath`, `resolveLink`, `linkTarget` (spec §2.8) |
| `src/markdown/metadata.ts` | `InlineFields`, `parseMetadataLine`, `formatMetadataLine`, `fitsMetadataLine` (spec §2.5) |
| `src/markdown/frontmatter.ts` | `readFrontmatter`, `formatFrontmatter`, `setFrontmatterFields` (minimal-diff YAML edits) |
| `src/markdown/items.ts` | Item heads and lines: `parseHead`, `formatHead`, `formatInlineItem`, `formatLinkedItem`, link-text escaping |
| `src/markdown/ast.ts` | `parseAst` (mdast with extensions), `lineSpan`, `headingText` |
| `src/markdown/todoFile.ts` | `parseTodoFile` → `TodoFile` (spec §2.3–§2.5) and the `TODO.md` edits |
| `src/markdown/taskFile.ts` | `parseTaskFile`, `formatTaskFile`, `updateTaskFile`, `prependComment`, timestamps (spec §2.6) |
| `src/markdown/convert.ts` | Format ↔ model: `inlineTask`, `fileTask`, `fitsInline`, `inlineItemFor`, `linkedItemFor`, `taskFileFor` |
| `src/markdown/normalize.ts` | `normalize` (text-only steps of spec §2.11), `staleLinkText` |
| `src/markdown/index.ts` | Public entry point `@lemol/todo-md/markdown` |
| `test/markdown/*.test.ts`, `test/markdown/fixtures.ts` | Tests and shared fixtures |

`src/markdown/index.ts` exists today as an `export {}` placeholder.

---

### Task 1: Lines, IDs and paths

**Files:**
- Create: `src/markdown/lines.ts`, `src/markdown/ids.ts`, `src/markdown/paths.ts`
- Test: `test/markdown/lines.test.ts`, `test/markdown/ids.test.ts`, `test/markdown/paths.test.ts`

**Interfaces:**
- Consumes: `TaskId` from `../spec/index.ts`.
- Produces:
  - `interface Lines { lines: ReadonlyArray<string>; eol: "\n" | "\r\n"; finalNewline: boolean }`
  - `splitLines(text): Lines` and `joinLines(lines): string`
  - `spliceLines(text: Lines, start, deleteCount, insert): Lines`
  - `isBlank(line?: string): boolean` and `trimBlock(lines): string`
  - `isId(s)`, `parseId(s): TaskId | undefined` (`"07"` → `"7"`), `formatId(id)` (`"7"` → `"07"`), `nextId(ids): TaskId`
  - `normalizePath(path): string | undefined` (`undefined` when the path leaves the root)
  - `joinPath(...parts)`, `resolveLink(url): string | undefined`, `linkTarget(path)` (`./path` or `<./path>`), `basename`, `dirname`
  - `slug(text, fallback)`, `groupSlug(group)`
  - `taskPath(dir, group, id, title)` → `"backend/07-add-rate-limiting.md"`

- [ ] **Step 1: Write the failing tests**

Create `test/markdown/lines.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { joinLines, spliceLines, splitLines, trimBlock } from "../../src/markdown/lines.ts"

describe("splitLines / joinLines", () => {
  test.each([
    ["", []],
    ["a", ["a"]],
    ["a\nb\n", ["a", "b"]],
    ["a\r\nb\r\n", ["a", "b"]],
    ["a\n\n", ["a", ""]],
  ])("round-trips %j", (text, lines) => {
    const split = splitLines(text)
    expect(split.lines).toEqual(lines)
    expect(joinLines(split)).toBe(text)
  })

  test("keeps CRLF line endings", () => {
    const text = spliceLines(splitLines("a\r\nc\r\n"), 1, 0, ["b"])
    expect(joinLines(text)).toBe("a\r\nb\r\nc\r\n")
  })
})

describe("spliceLines", () => {
  test("replaces lines in the middle", () => {
    expect(joinLines(spliceLines(splitLines("a\nb\nc\n"), 1, 1, ["x", "y"]))).toBe("a\nx\ny\nc\n")
  })

  test("ends the text with a newline when appending", () => {
    expect(joinLines(spliceLines(splitLines("a"), 1, 0, ["b"]))).toBe("a\nb\n")
    expect(joinLines(spliceLines(splitLines(""), 0, 0, ["a"]))).toBe("a\n")
  })
})

test("trimBlock drops leading and trailing blank lines", () => {
  expect(trimBlock(["", "a", "", "b", " ", ""])).toBe("a\n\nb")
})
```

Create `test/markdown/ids.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { formatId, isId, nextId, parseId } from "../../src/markdown/ids.ts"

describe("IDs", () => {
  test("parseId strips leading zeros and rejects non-digits", () => {
    expect(parseId("07")).toBe("7")
    expect(parseId("0")).toBe("0")
    expect(parseId("105")).toBe("105")
    expect(parseId("7a")).toBeUndefined()
    expect(parseId("")).toBeUndefined()
  })

  test("formatId pads to at least two digits", () => {
    expect(formatId("7")).toBe("07")
    expect(formatId("12")).toBe("12")
    expect(formatId("105")).toBe("105")
  })

  test("nextId is one more than the largest ID", () => {
    expect(nextId([])).toBe("1")
    expect(nextId(["3", "12", "7"])).toBe("13")
    expect(nextId(["99999999999999999999"])).toBe("100000000000000000000")
  })

  test("isId accepts only digits", () => {
    expect(isId("07")).toBe(true)
    expect(isId("PROJ-1")).toBe(false)
  })
})
```

Create `test/markdown/paths.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import {
  basename,
  dirname,
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
    expect(basename("backend/07-x.md")).toBe("07-x.md")
    expect(dirname("backend/07-x.md")).toBe("backend")
    expect(dirname("07-x.md")).toBe("")
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/markdown`
Expected: FAIL with `Cannot find module '../../src/markdown/lines.ts'`, and the same for `ids.ts` and `paths.ts`.

- [ ] **Step 3: Write the helpers**

Create `src/markdown/lines.ts`:

```ts
/**
 * Text as lines, remembering the line ending style and whether the text ended
 * with one, so edits can rewrite only the lines they touch (spec §2.10).
 */
export interface Lines {
  readonly lines: ReadonlyArray<string>
  readonly eol: "\n" | "\r\n"
  readonly finalNewline: boolean
}

export const splitLines = (text: string): Lines => {
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  const finalNewline = text.endsWith("\n")
  const body = finalNewline ? text.slice(0, text.endsWith("\r\n") ? -2 : -1) : text
  return { lines: text === "" ? [] : body.split(/\r?\n/), eol, finalNewline }
}

export const joinLines = ({ lines, eol, finalNewline }: Lines): string =>
  lines.length === 0 ? "" : lines.join(eol) + (finalNewline ? eol : "")

/**
 * Replaces `deleteCount` lines at `start` with `insert`. Appending at the end
 * of the text also ends it with a newline.
 */
export const spliceLines = (
  text: Lines,
  start: number,
  deleteCount: number,
  insert: ReadonlyArray<string>,
): Lines => {
  const lines = [...text.lines]
  lines.splice(start, deleteCount, ...insert)
  const appended = insert.length > 0 && start + deleteCount >= text.lines.length
  return { ...text, lines, finalNewline: text.finalNewline || appended }
}

export const isBlank = (line: string | undefined): boolean =>
  line !== undefined && line.trim() === ""

/** Joins lines into a block of text without leading or trailing blank lines. */
export const trimBlock = (lines: ReadonlyArray<string>): string => {
  let start = 0
  let end = lines.length
  while (start < end && isBlank(lines[start])) start++
  while (end > start && isBlank(lines[end - 1])) end--
  return lines.slice(start, end).join("\n")
}
```

Create `src/markdown/ids.ts`:

```ts
import type { TaskId } from "../spec/index.ts"

const digits = /^\d+$/

/** Whether `value` is a task ID in the file-system format: decimal digits (spec §2.7). */
export const isId = (value: string): boolean => digits.test(value)

/** The model form of an ID: digits without leading zeros (`"07"` → `"7"`). */
export const parseId = (value: string): TaskId | undefined =>
  digits.test(value) ? value.replace(/^0+(?=\d)/, "") : undefined

/** The written form of an ID: zero-padded to at least 2 digits (`"7"` → `"07"`). */
export const formatId = (id: TaskId): string => id.padStart(2, "0")

/** One more than the largest ID in `ids` (`"1"` when there are none). */
export const nextId = (ids: Iterable<TaskId>): TaskId => {
  let max = 0n
  for (const id of ids) {
    if (digits.test(id) && BigInt(id) > max) max = BigInt(id)
  }
  return String(max + 1n)
}
```

Create `src/markdown/paths.ts`:

```ts
import { formatId } from "./ids.ts"

/**
 * Posix path helpers for paths relative to the list root. The markdown module
 * does no I/O, so it cannot use the platform's path module.
 */

/** Resolves `.` and `..` segments. Returns `undefined` if the path leaves the root or is absolute. */
export const normalizePath = (path: string): string | undefined => {
  if (path.startsWith("/") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) return undefined
  const segments: string[] = []
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue
    if (segment === "..") {
      if (segments.length === 0) return undefined
      segments.pop()
    } else {
      segments.push(segment)
    }
  }
  return segments.join("/")
}

export const joinPath = (...parts: ReadonlyArray<string>): string =>
  normalizePath(parts.join("/")) ?? parts.join("/")

/** The root-relative path a link in `TODO.md` points to, or `undefined` if it leaves the root. */
export const resolveLink = (url: string): string | undefined => {
  let decoded = url
  try {
    decoded = decodeURI(url)
  } catch {
    // keep the raw URL when it is not valid percent-encoding
  }
  const path = normalizePath(decoded)
  return path === undefined || path === "" ? undefined : path
}

/** The link target writers use for a root-relative path: `./path`, in angle brackets if needed. */
export const linkTarget = (path: string): string =>
  /[\s()<>]/.test(path) ? `<./${path}>` : `./${path}`

/** The file name without directories. */
export const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1)

/** The directory part of a path (`""` for a file at the root). */
export const dirname = (path: string): string => {
  const index = path.lastIndexOf("/")
  return index === -1 ? "" : path.slice(0, index)
}

/**
 * A file-name-safe slug (spec §2.8): ASCII letters and digits, lowercase,
 * other runs replaced by `-`, at most 60 characters, cut at a `-` if possible.
 */
export const slug = (text: string, fallback: string): string => {
  const base = text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (base.length <= 60) return base === "" ? fallback : base
  const cut = base.slice(0, 60)
  const boundary = base[60] === "-" ? 60 : cut.lastIndexOf("-")
  return (boundary > 0 ? cut.slice(0, boundary) : cut).replace(/-+$/, "")
}

export const groupSlug = (group: string): string => slug(group, "group")

/**
 * Where a writer puts a task file (spec §2.8):
 * `<dir>/<group-slug>/<id>-<title-slug>.md`, without the group directory when ungrouped.
 */
export const taskPath = (
  dir: string,
  group: string | undefined,
  id: string,
  title: string,
): string =>
  joinPath(
    dir,
    ...(group === undefined ? [] : [groupSlug(group)]),
    `${formatId(id)}-${slug(title, "task")}.md`,
  )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test test/markdown`
Expected: `22 pass`, `0 fail`.

- [ ] **Step 5: Run the gate and commit**

```bash
bun run check
git add src/markdown/lines.ts src/markdown/ids.ts src/markdown/paths.ts test/markdown
git commit -m "Add line, ID and path helpers for the todo.md format" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014ak6bnNqeftYod6YDrWkcK"
```

---

### Task 2: The metadata line

**Files:**
- Create: `src/markdown/metadata.ts`
- Test: `test/markdown/metadata.test.ts`

**Interfaces:**
- Consumes: `Diagnostic`, `TaskId` and `unique` from `../spec/index.ts`; `parseId` from Task 1.
- Produces:
  - `interface InlineFields { tags; assignee: string | undefined; dependsOn: ReadonlyArray<TaskId>; extra: Record<string, unknown> }` and `noFields`.
  - `parseMetadataLine(line): { fields: InlineFields; diagnostics: Diagnostic[] } | undefined`. It returns `undefined` when the line is description. Its diagnostics carry no location; callers add `file`/`line`.
  - `formatMetadataLine(fields): string`, which returns `""` when there is nothing to write.
  - `fitsMetadataLine(fields): boolean`, which says whether the fields can be written as a metadata line.

- [ ] **Step 1: Write the failing test**

Create `test/markdown/metadata.test.ts`:

```ts
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
  ])("rejects %s", (_label, fields) => {
    expect(fitsMetadataLine(fields)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/markdown/metadata.test.ts`
Expected: FAIL with `Cannot find module '../../src/markdown/metadata.ts'`.

- [ ] **Step 3: Write the metadata line grammar**

Create `src/markdown/metadata.ts`:

```ts
import { parse as parseYaml } from "yaml"
import { type Diagnostic, type TaskId, unique } from "../spec/index.ts"
import { parseId } from "./ids.ts"

/** The fields a metadata line can carry (spec §2.5). */
export interface InlineFields {
  readonly tags: ReadonlyArray<string>
  readonly assignee: string | undefined
  readonly dependsOn: ReadonlyArray<TaskId>
  readonly extra: Readonly<Record<string, unknown>>
}

export const noFields: InlineFields = { tags: [], assignee: undefined, dependsOn: [], extra: {} }

export interface ParsedMetadata {
  readonly fields: InlineFields
  /** Problems found in an otherwise valid metadata line; the caller adds the location. */
  readonly diagnostics: ReadonlyArray<Diagnostic>
}

const word = /^[\p{L}\p{N}_\-/.]+$/u
const keyValue = /^([a-z][a-z0-9_]*):([^\s/]\S*)$/
const reserved = new Set(["title", "completed_at", "group", "id"])
const standard = new Set(["tags", "assignee", "depends_on"])

const isToken = (token: string): boolean =>
  ((token.startsWith("#") || token.startsWith("@")) && word.test(token.slice(1))) ||
  keyValue.test(token)

/** Reads a `key:value` value as a YAML plain scalar: `3` is a number, `true` a boolean. */
const scalar = (value: string): unknown => {
  if (/^[[{]/.test(value)) return value
  try {
    const parsed: unknown = parseYaml(value)
    return parsed === null || typeof parsed === "object" ? value : parsed
  } catch {
    return value
  }
}

const error = (code: string, message: string): Diagnostic => ({ severity: "error", code, message })

/**
 * Parses a metadata line. Returns `undefined` when the line is description:
 * it is metadata only if every token is `#tag`, `@name` or `key:value`.
 */
export const parseMetadataLine = (line: string): ParsedMetadata | undefined => {
  const tokens = line
    .trim()
    .split(/\s+/)
    .flatMap((chunk) => chunk.split(/,(?=[#@])/))
    .filter((token) => token !== "")
  if (tokens.length === 0 || !tokens.every(isToken)) return undefined

  const tags: string[] = []
  const assignees: string[] = []
  const dependsOn: TaskId[] = []
  const extra: Record<string, unknown> = {}
  const diagnostics: Diagnostic[] = []

  for (const token of tokens) {
    if (token.startsWith("#")) {
      tags.push(token.slice(1))
      continue
    }
    if (token.startsWith("@")) {
      assignees.push(token.slice(1))
      continue
    }
    const [, key = "", value = ""] = keyValue.exec(token) ?? []
    if (reserved.has(key)) {
      diagnostics.push(error("reserved-field", `${key} cannot be set on a metadata line`))
    } else if (key === "tags") {
      tags.push(...value.split(",").filter((tag) => tag !== ""))
    } else if (key === "assignee") {
      assignees.push(value)
    } else if (key === "depends_on") {
      const ids = value.split(",").map(parseId)
      if (ids.every((id) => id !== undefined)) {
        dependsOn.push(...ids)
      } else {
        diagnostics.push(error("invalid-metadata", `depends_on must list task IDs: ${value}`))
      }
    } else {
      extra[key] = scalar(value)
    }
  }
  if (assignees.length > 1) {
    diagnostics.push(error("multiple-assignees", `more than one assignee: ${assignees.join(", ")}`))
  }

  return {
    fields: { tags: unique(tags), assignee: assignees[0], dependsOn: unique(dependsOn), extra },
    diagnostics,
  }
}

/** The single token for an extra value, or `undefined` if it cannot be written inline. */
const token = (value: unknown): string | undefined => {
  const text =
    typeof value === "string"
      ? value
      : (typeof value === "number" && Number.isFinite(value)) || typeof value === "boolean"
        ? String(value)
        : undefined
  if (text === undefined || !/^[^\s/]\S*$/.test(text) || /,[#@]/.test(text)) return undefined
  return scalar(text) === value ? text : undefined
}

/** Whether `fields` can be written as a metadata line; otherwise the task needs a file (spec §2.9). */
export const fitsMetadataLine = (fields: InlineFields): boolean =>
  fields.tags.every((tag) => word.test(tag)) &&
  (fields.assignee === undefined || word.test(fields.assignee)) &&
  Object.entries(fields.extra).every(
    ([key, value]) =>
      /^[a-z][a-z0-9_]*$/.test(key) &&
      !reserved.has(key) &&
      !standard.has(key) &&
      token(value) !== undefined,
  )

/** Formats `fields` as a metadata line (`""` when there is nothing to write). Requires `fitsMetadataLine`. */
export const formatMetadataLine = (fields: InlineFields): string =>
  [
    ...fields.tags.map((tag) => `#${tag}`),
    ...(fields.assignee === undefined ? [] : [`@${fields.assignee}`]),
    ...(fields.dependsOn.length === 0 ? [] : [`depends_on:${fields.dependsOn.join(",")}`]),
    ...Object.entries(fields.extra).map(([key, value]) => `${key}:${token(value)}`),
  ].join(" ")
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test test/markdown/metadata.test.ts`
Expected: `14 pass`, `0 fail`.

- [ ] **Step 5: Run the gate and commit**

```bash
bun run check
git add src/markdown/metadata.ts test/markdown/metadata.test.ts
git commit -m "Parse and write todo.md metadata lines" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014ak6bnNqeftYod6YDrWkcK"
```

---

### Task 3: Minimal-diff frontmatter

**Files:**
- Create: `src/markdown/frontmatter.ts`
- Test: `test/markdown/frontmatter.test.ts`

**Interfaces:**
- Consumes: `yaml` (`Document`, `parseDocument`, `isMap`, `isScalar`).
- Produces:
  - `readFrontmatter(yaml): { data: Record<string, unknown>; error: string | undefined }`
  - `formatFrontmatter(fields: Array<[key, value]>): string[]`, with flow-style lists (`[a, b]`).
  - `setFrontmatterFields(yaml, fields): string[]`. It sets or deletes (`undefined`) keys, rewriting only the lines of keys whose value changes.

  All three take and return frontmatter *without* the `---` fences.

- [ ] **Step 1: Write the failing test**

Create `test/markdown/frontmatter.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/markdown/frontmatter.test.ts`
Expected: FAIL with `Cannot find module '../../src/markdown/frontmatter.ts'`.

- [ ] **Step 3: Write the frontmatter helpers**

Create `src/markdown/frontmatter.ts`:

```ts
import { Document, isMap, isScalar, parseDocument } from "yaml"

export interface FrontmatterData {
  readonly data: Readonly<Record<string, unknown>>
  /** Why the YAML could not be read, if it could not. */
  readonly error: string | undefined
}

/** Reads frontmatter YAML (without the `---` fences) into a plain object. */
export const readFrontmatter = (yaml: string): FrontmatterData => {
  const doc = parseDocument(yaml)
  const [first] = doc.errors
  if (first !== undefined) return { data: {}, error: first.message.split("\n")[0] }
  const value: unknown = doc.toJS()
  if (value === null || value === undefined) return { data: {}, error: undefined }
  if (typeof value !== "object" || Array.isArray(value)) {
    return { data: {}, error: "frontmatter must be a mapping" }
  }
  return { data: value as Record<string, unknown>, error: undefined }
}

const isScalarList = (value: unknown): value is ReadonlyArray<unknown> =>
  Array.isArray(value) && value.every((item) => item === null || typeof item !== "object")

/** One `key: value` entry as YAML lines; lists of scalars use flow style (`[a, b]`). */
const entry = (key: string, value: unknown): string[] => {
  const doc = new Document({})
  doc.set(key, isScalarList(value) ? doc.createNode(value, { flow: true }) : value)
  return doc.toString({ flowCollectionPadding: false }).replace(/\n$/, "").split("\n")
}

/** Formats fields, in order, as frontmatter lines (without the `---` fences). */
export const formatFrontmatter = (fields: ReadonlyArray<readonly [string, unknown]>): string[] =>
  fields.flatMap(([key, value]) => entry(key, value))

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * Sets top-level keys in frontmatter `yaml`; `undefined` deletes a key. Only
 * the lines of keys whose value changes are rewritten, and new keys are
 * appended, so comments and formatting elsewhere survive (spec §2.10).
 * Returns the new frontmatter lines.
 */
export const setFrontmatterFields = (
  yaml: string,
  fields: Readonly<Record<string, unknown>>,
): string[] => {
  const lines = yaml === "" ? [] : yaml.split("\n")
  const doc = parseDocument(yaml)
  const current = readFrontmatter(yaml).data
  const map = doc.contents
  const blockMap = isMap(map) && !map.flow
  if (doc.errors.length > 0 || (map !== null && !blockMap)) {
    const merged = { ...current, ...fields }
    return formatFrontmatter(Object.entries(merged).filter(([, value]) => value !== undefined))
  }

  const lineOf = (offset: number) => yaml.slice(0, offset).split("\n").length - 1
  const edits: Array<{ start: number; end: number; lines: string[] }> = []
  const appended: string[] = []
  for (const [key, value] of Object.entries(fields)) {
    if (same(current[key], value)) continue
    const pair = blockMap
      ? map.items.find((item) => isScalar(item.key) && item.key.value === key)
      : undefined
    const keyRange = pair !== undefined && isScalar(pair.key) ? pair.key.range : undefined
    if (keyRange == null) {
      if (value !== undefined) appended.push(...entry(key, value))
      continue
    }
    const valueRange = (pair?.value as { range?: [number, number, number] } | null)?.range
    const end = Math.max((valueRange ?? keyRange)[1] - 1, keyRange[0])
    edits.push({
      start: lineOf(keyRange[0]),
      end: lineOf(end),
      lines: value === undefined ? [] : entry(key, value),
    })
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    lines.splice(edit.start, edit.end - edit.start + 1, ...edit.lines)
  }
  return [...lines, ...appended]
}
```

Why line edits and not `doc.toString()`: re-serializing reformats untouched keys (`[api, security]` becomes `[ api, security ]`), which breaks the minimal-diff rule.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test test/markdown/frontmatter.test.ts`
Expected: `8 pass`, `0 fail`.

- [ ] **Step 5: Run the gate and commit**

```bash
bun run check
git add src/markdown/frontmatter.ts test/markdown/frontmatter.test.ts
git commit -m "Read and edit YAML frontmatter with minimal diffs" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014ak6bnNqeftYod6YDrWkcK"
```

---

### Task 4: Task items

**Files:**
- Create: `src/markdown/items.ts`
- Test: `test/markdown/items.test.ts`

**Interfaces:**
- Consumes: `formatId`, `isBlank`, `formatMetadataLine`, `parseMetadataLine`, `InlineFields`, `linkTarget`.
- Produces:
  - `parseHead(head): { id: string | undefined; title }`, which splits at the first ` - ` after the digits.
  - `formatHead(id, title)` → `"07 - Title"`.
  - `escapeLinkText` and `unescapeLinkText`.
  - `formatInlineItem({ id, title, checked?, fields, description }): string[]`
  - `formatLinkedItem({ id, title, checked?, path }): string[]`

- [ ] **Step 1: Write the failing test**

Create `test/markdown/items.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import {
  escapeLinkText,
  formatInlineItem,
  formatLinkedItem,
  parseHead,
  unescapeLinkText,
} from "../../src/markdown/items.ts"
import { noFields } from "../../src/markdown/metadata.ts"

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
})

test("escapeLinkText and unescapeLinkText round-trip", () => {
  expect(unescapeLinkText(escapeLinkText("a [b] \\ c"))).toBe("a [b] \\ c")
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/markdown/items.test.ts`
Expected: FAIL with `Cannot find module '../../src/markdown/items.ts'`.

- [ ] **Step 3: Write the item helpers**

Create `src/markdown/items.ts`:

```ts
import type { TaskId } from "../spec/index.ts"
import { formatId } from "./ids.ts"
import { isBlank } from "./lines.ts"
import { formatMetadataLine, type InlineFields, parseMetadataLine } from "./metadata.ts"
import { linkTarget } from "./paths.ts"

/** Escapes the characters that would end or nest a link's text. */
export const escapeLinkText = (text: string): string => text.replace(/[\\[\]]/g, "\\$&")

/** Removes Markdown backslash escapes. */
export const unescapeLinkText = (text: string): string => text.replace(/\\([!-/:-@[-`{-~])/g, "$1")

/** The head of an item: `<id> - <title>`. */
export const formatHead = (id: TaskId, title: string): string => `${formatId(id)} - ${title}`

/** Splits a head into ID and title; a head without `<digits> - ` has no ID (spec §2.4). */
export const parseHead = (
  head: string,
): { readonly id: string | undefined; readonly title: string } => {
  const match = /^(\d+) - (.*)$/.exec(head)
  return match === null
    ? { id: undefined, title: head.trim() }
    : { id: match[1]?.replace(/^0+(?=\d)/, ""), title: (match[2] ?? "").trim() }
}

const checkbox = (checked: boolean | undefined) => (checked === true ? "[x]" : "[ ]")

export interface InlineItem {
  readonly id: TaskId
  readonly title: string
  readonly checked?: boolean
  readonly fields: InlineFields
  readonly description: string
}

/** The canonical lines of an inline task item (spec §2.4, §2.5). */
export const formatInlineItem = (item: InlineItem): string[] => {
  const metadata = formatMetadataLine(item.fields)
  const description = item.description === "" ? [] : item.description.split("\n")
  const [firstLine] = description
  const separate =
    metadata === "" && firstLine !== undefined && parseMetadataLine(firstLine) !== undefined
  const body = [...(metadata === "" ? [] : [metadata]), ...(separate ? [""] : []), ...description]
  return [
    `- ${checkbox(item.checked)} ${formatHead(item.id, item.title)}`,
    ...body.map((line) => (isBlank(line) ? "" : `  ${line}`)),
  ]
}

export interface LinkedItem {
  readonly id: TaskId
  readonly title: string
  readonly checked?: boolean
  /** Root-relative path of the task file. */
  readonly path: string
}

/** The canonical line of a linked task item. */
export const formatLinkedItem = (item: LinkedItem): string[] => [
  `- ${checkbox(item.checked)} [${escapeLinkText(formatHead(item.id, item.title))}](${linkTarget(item.path)})`,
]
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test test/markdown/items.test.ts`
Expected: `7 pass`, `0 fail`.

- [ ] **Step 5: Run the gate and commit**

```bash
bun run check
git add src/markdown/items.ts test/markdown/items.test.ts
git commit -m "Format and read todo.md task items" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014ak6bnNqeftYod6YDrWkcK"
```

---

### Task 5: Parsing TODO.md

**Files:**
- Create: `src/markdown/ast.ts`, `src/markdown/todoFile.ts`
- Test: `test/markdown/fixtures.ts`, `test/markdown/todoFile.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4 and `mdast-util-from-markdown` with the frontmatter and GFM task-list extensions.
- Produces:
  - `parseAst(source): Root`, `lineSpan(node): { start, end }` (0-based, end exclusive), and `headingText(source, heading): { text, from, to }`.
  - `interface ListConfig { tasksDir; doneDir }` and `defaultConfig` (`{ tasksDir: ".", doneDir: "done" }`).
  - `interface TodoItem`:
    - `start` and `end`: the 0-based line range `[start, end)` of the item and its body;
    - `id: TaskId | undefined`, `checked`, `title`;
    - `linked`, and `path` (root-relative, `undefined` if the link leaves the root);
    - `fields: InlineFields` and `description` (inline items);
    - `headColumn` and `linkText: [from, to] | undefined`.
  - `interface TodoSection`:
    - `name: string | undefined` (`undefined` for the ungrouped section) and `description`;
    - `heading: { line, from, to } | undefined`;
    - `start`, `end` and `items`.
  - `interface TodoFile { text: Lines; config; title; description; sections; diagnostics }`. `sections[0]` is always the ungrouped section.
  - `parseTodoFile(source): TodoFile`. It never fails; it reports `invalid-frontmatter`, `duplicate-group`, `outside-root`, `id-mismatch`, `linked-body`, `reserved-field`, `multiple-assignees`, `invalid-metadata`, `missing-id` and `checked-item` with `file: "TODO.md"` and 1-based `line`.
  - `allItems(todo)`, `findItem(todo, id)`, `sectionOf(todo, item)`.

- [ ] **Step 1: Write the fixtures and the failing test**

Create `test/markdown/fixtures.ts`:

```ts
import { findItem, type TodoFile, type TodoItem } from "../../src/markdown/todoFile.ts"

export const md = (...lines: string[]) => `${lines.join("\n")}\n`

export const example = md(
  "---",
  "done_dir: archive",
  "---",
  "# Acme API",
  "",
  "Backlog for the Acme API.",
  "",
  "- [ ] 14 - Write changelog",
  "",
  "## Backend",
  "",
  "Server-side work.",
  "",
  "- [ ] [07 - Add rate limiting](./backend/07-add-rate-limiting.md)",
  "- [ ] 03 - Fix login redirect",
  "  #bug @lemol depends_on:1",
  "  Users land on /home instead of the page they requested.",
  "",
  "  - check the referrer",
  "",
  "A note between tasks.",
  "",
  "* [X] 09 - Bump deps",
  "",
  "## Frontend ##",
)

export const itemOf = (todo: TodoFile, id: string): TodoItem => {
  const found = findItem(todo, id)
  if (found === undefined) throw new Error(`no item ${id}`)
  return found
}
```

Create `test/markdown/todoFile.test.ts`:

````ts
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
````

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/markdown/todoFile.test.ts`
Expected: FAIL with `Cannot find module '../../src/markdown/todoFile.ts'`.

- [ ] **Step 3: Write the AST helpers**

Create `src/markdown/ast.ts`:

```ts
import type { Heading, Nodes, Root } from "mdast"
import { fromMarkdown } from "mdast-util-from-markdown"
import { frontmatterFromMarkdown } from "mdast-util-frontmatter"
import { gfmTaskListItemFromMarkdown } from "mdast-util-gfm-task-list-item"
import { frontmatter } from "micromark-extension-frontmatter"
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item"

/** Parses Markdown (CommonMark + YAML frontmatter + GFM task list items) into an mdast tree. */
export const parseAst = (source: string): Root =>
  fromMarkdown(source, {
    extensions: [frontmatter(["yaml"]), gfmTaskListItem()],
    mdastExtensions: [frontmatterFromMarkdown(["yaml"]), gfmTaskListItemFromMarkdown()],
  })

/** The 0-based line range `[start, end)` a node covers. */
export const lineSpan = (node: Nodes): { readonly start: number; readonly end: number } => ({
  start: (node.position?.start.line ?? 1) - 1,
  end: node.position?.end.line ?? 0,
})

/** A heading's raw text and its 0-based column range on its first line. */
export const headingText = (
  source: string,
  heading: Heading,
): { readonly text: string; readonly from: number; readonly to: number } => {
  const first = heading.children[0]?.position
  const last = heading.children.at(-1)?.position
  if (first === undefined || last === undefined) return { text: "", from: 0, to: 0 }
  return {
    text: source.slice(first.start.offset, last.end.offset).trim(),
    from: first.start.column - 1,
    to: first.start.line === last.end.line ? last.end.column - 1 : first.start.column - 1,
  }
}
```

- [ ] **Step 4: Write the parser**

Create `src/markdown/todoFile.ts`:

```ts
import type { Heading, ListItem } from "mdast"
import type { Diagnostic, TaskId } from "../spec/index.ts"
import { headingText, lineSpan, parseAst } from "./ast.ts"
import { readFrontmatter } from "./frontmatter.ts"
import { parseId } from "./ids.ts"
import { parseHead, unescapeLinkText } from "./items.ts"
import { isBlank, type Lines, splitLines, trimBlock } from "./lines.ts"
import { type InlineFields, noFields, parseMetadataLine } from "./metadata.ts"
import { basename, groupSlug, normalizePath, resolveLink } from "./paths.ts"

/** List configuration from `TODO.md` frontmatter (spec §2.2). Paths are relative to the list root. */
export interface ListConfig {
  readonly tasksDir: string
  readonly doneDir: string
}

export const defaultConfig: ListConfig = { tasksDir: ".", doneDir: "done" }

export interface TodoItem {
  /** 0-based line range `[start, end)` of the item and its body. */
  readonly start: number
  readonly end: number
  /** `undefined` until normalization assigns one (spec §2.4). */
  readonly id: TaskId | undefined
  readonly checked: boolean
  readonly title: string
  readonly linked: boolean
  /** Linked items: the task file's root-relative path, `undefined` if the link leaves the root. */
  readonly path: string | undefined
  /** Inline items: the metadata line's fields. */
  readonly fields: InlineFields
  /** Inline items: the description, de-indented. */
  readonly description: string
  /** Column where the head (`<id> - <title>` or the link) starts on the first line. */
  readonly headColumn: number
  /** Linked items: the column range of the link text on the first line. */
  readonly linkText: readonly [number, number] | undefined
}

export interface TodoSection {
  /** `undefined` for the ungrouped section, which is always first. */
  readonly name: string | undefined
  readonly description: string
  /** Groups: the heading's 0-based line and the column range of its name. */
  readonly heading:
    | { readonly line: number; readonly from: number; readonly to: number }
    | undefined
  /** 0-based line range `[start, end)` of the section. */
  readonly start: number
  readonly end: number
  readonly items: ReadonlyArray<TodoItem>
}

/** A parsed `TODO.md` (spec §2.3). */
export interface TodoFile {
  readonly text: Lines
  readonly config: ListConfig
  readonly title: string
  readonly description: string
  /** The ungrouped section first, then one per group, in document order. */
  readonly sections: ReadonlyArray<TodoSection>
  readonly diagnostics: ReadonlyArray<Diagnostic>
}

const file = "TODO.md"

/** Columns of content inside a list item: the bullet, then 1–4 spaces (CommonMark). */
const contentIndent = (line: string): number => {
  const match = /^(\s*)[-*+]( +)/.exec(line)
  if (match === null) return 0
  const spaces = match[2]?.length ?? 1
  return (match[1]?.length ?? 0) + 1 + (spaces > 4 ? 1 : spaces)
}

const dedent = (line: string, columns: number): string =>
  line.slice(Math.min(columns, line.length - line.trimStart().length))

const readConfig = (yaml: string, diagnostics: Diagnostic[]): ListConfig => {
  const { data, error } = readFrontmatter(yaml)
  const report = (message: string) =>
    diagnostics.push({ severity: "error", code: "invalid-frontmatter", message, file, line: 1 })
  if (error !== undefined) report(error)
  const dir = (key: string, fallback: string): string => {
    const value = data[key]
    if (value === undefined) return fallback
    const path = typeof value === "string" ? normalizePath(value) : undefined
    if (path === undefined) {
      report(`${key} must be a path inside the list root`)
      return fallback
    }
    return path === "" ? "." : path
  }
  return {
    tasksDir: dir("tasks_dir", defaultConfig.tasksDir),
    doneDir: dir("done_dir", defaultConfig.doneDir),
  }
}

/** Parses `TODO.md`. Never fails: problems become diagnostics. */
export const parseTodoFile = (source: string): TodoFile => {
  const text = splitLines(source)
  const tree = parseAst(source)
  const diagnostics: Diagnostic[] = []
  let config = defaultConfig
  let title = ""
  let ungroupedStart = 0
  const ungrouped: TodoItem[] = []
  const groups: Array<{
    name: string
    heading: NonNullable<TodoSection["heading"]>
    items: TodoItem[]
  }> = []

  const parseItem = (node: ListItem): TodoItem | undefined => {
    const { start, end } = lineSpan(node)
    const first = text.lines[start] ?? ""
    const prefix = /^\s*[-*+]\s+\[[ xX]\]\s*/.exec(first)
    if (node.checked == null || prefix === null) return undefined
    const headColumn = prefix[0].length
    const head = first.slice(headColumn).trimEnd()
    if (head === "") return undefined
    const indent = contentIndent(first)
    const body = text.lines.slice(start + 1, end).map((line) => dedent(line, indent))
    const location = { file, line: start + 1 }
    const paragraph = node.children[0]
    const link = paragraph?.type === "paragraph" ? paragraph.children[0] : undefined
    const linkPosition = link?.position
    const isLink =
      link?.type === "link" &&
      linkPosition !== undefined &&
      linkPosition.start.line === start + 1 &&
      linkPosition.end.line === start + 1 &&
      linkPosition.start.column - 1 === headColumn &&
      first.slice(linkPosition.end.column - 1).trim() === ""

    let item: TodoItem
    if (isLink && link?.type === "link") {
      const from = (link.children[0]?.position?.start.column ?? headColumn + 2) - 1
      const to = (link.children.at(-1)?.position?.end.column ?? headColumn + 2) - 1
      const { id, title } = parseHead(unescapeLinkText(first.slice(from, to)))
      const path = resolveLink(link.url)
      if (path === undefined) {
        diagnostics.push({
          severity: "error",
          code: "outside-root",
          message: `link leaves the list root: ${link.url}`,
          ...location,
        })
      } else {
        const prefixId = /^(\d+)-/.exec(basename(path))?.[1]
        if (id !== undefined && prefixId !== undefined && parseId(prefixId) !== id) {
          diagnostics.push({
            severity: "warning",
            code: "id-mismatch",
            message: `task ${id} links to ${path}`,
            taskId: id,
            ...location,
          })
        }
      }
      if (body.some((line) => !isBlank(line))) {
        diagnostics.push({
          severity: "warning",
          code: "linked-body",
          message: "a linked item's body is ignored; move it to the task file",
          ...location,
        })
      }
      item = {
        start,
        end,
        id,
        checked: node.checked,
        title,
        linked: true,
        path,
        fields: noFields,
        description: "",
        headColumn,
        linkText: [from, to],
      }
    } else {
      const { id, title } = parseHead(head)
      const [firstBody] = body
      const metadata =
        firstBody === undefined || isBlank(firstBody) ? undefined : parseMetadataLine(firstBody)
      for (const diagnostic of metadata?.diagnostics ?? []) {
        diagnostics.push({
          ...diagnostic,
          ...(id === undefined ? {} : { taskId: id }),
          file,
          line: start + 2,
        })
      }
      const description = trimBlock(metadata === undefined ? body : body.slice(1))
      item = {
        start,
        end,
        id,
        checked: node.checked,
        title,
        linked: false,
        path: undefined,
        fields: metadata?.fields ?? noFields,
        description,
        headColumn,
        linkText: undefined,
      }
    }
    if (item.id === undefined) {
      diagnostics.push({
        severity: "info",
        code: "missing-id",
        message: `"${item.title}" needs an ID`,
        ...location,
      })
    }
    if (item.checked) {
      diagnostics.push({
        severity: "info",
        code: "checked-item",
        message: `"${item.title}" is checked and will move to done`,
        ...(item.id === undefined ? {} : { taskId: item.id }),
        ...location,
      })
    }
    return item
  }

  for (const node of tree.children) {
    const { start, end } = lineSpan(node)
    if (node.type === "yaml") {
      config = readConfig(node.value, diagnostics)
      ungroupedStart = end
    } else if (node.type === "heading" && node.depth === 1 && title === "" && groups.length === 0) {
      title = headingText(source, node).text
      ungroupedStart = end
    } else if (
      node.type === "heading" &&
      node.depth === 2 &&
      headingText(source, node).text !== ""
    ) {
      const { text: name, from, to } = headingText(source, node as Heading)
      const duplicate = groups.find(
        (group) => group.name === name || groupSlug(group.name) === groupSlug(name),
      )
      if (duplicate !== undefined) {
        diagnostics.push({
          severity: "error",
          code: "duplicate-group",
          message: `group "${name}" duplicates "${duplicate.name}"`,
          file,
          line: start + 1,
        })
      }
      groups.push({ name, heading: { line: start, from, to }, items: [] })
    } else if (node.type === "list") {
      for (const child of node.children) {
        const item = parseItem(child)
        if (item !== undefined) (groups.at(-1)?.items ?? ungrouped).push(item)
      }
    }
  }

  const describe = (from: number, items: ReadonlyArray<TodoItem>, end: number) =>
    trimBlock(text.lines.slice(from, items[0]?.start ?? end))
  const ungroupedEnd = groups[0]?.heading.line ?? text.lines.length
  const sections: TodoSection[] = [
    {
      name: undefined,
      description: describe(ungroupedStart, ungrouped, ungroupedEnd),
      heading: undefined,
      start: ungroupedStart,
      end: ungroupedEnd,
      items: ungrouped,
    },
    ...groups.map((group, index) => {
      const end = groups[index + 1]?.heading.line ?? text.lines.length
      return {
        name: group.name,
        description: describe(group.heading.line + 1, group.items, end),
        heading: group.heading,
        start: group.heading.line,
        end,
        items: group.items,
      }
    }),
  ]
  return { text, config, title, description: sections[0]?.description ?? "", sections, diagnostics }
}

/** Every item, in document order. */
export const allItems = (todo: TodoFile): ReadonlyArray<TodoItem> =>
  todo.sections.flatMap((section) => section.items)

export const findItem = (todo: TodoFile, id: TaskId): TodoItem | undefined =>
  allItems(todo).find((item) => item.id === id)

/** The section an item belongs to. */
export const sectionOf = (todo: TodoFile, item: TodoItem): TodoSection | undefined =>
  todo.sections.find((section) => section.items.includes(item))
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test test/markdown/todoFile.test.ts`
Expected: `15 pass`, `0 fail`.

- [ ] **Step 6: Run the gate and commit**

```bash
bun run check
git add src/markdown/ast.ts src/markdown/todoFile.ts test/markdown/fixtures.ts test/markdown/todoFile.test.ts
git commit -m "Parse TODO.md into sections, items and diagnostics" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014ak6bnNqeftYod6YDrWkcK"
```

---

### Task 6: Editing TODO.md

**Files:**
- Modify: `src/markdown/todoFile.ts`
- Test: `test/markdown/todoEdits.test.ts`

**Interfaces:**
- Consumes: Task 5's `TodoFile`, `TodoItem` and `TodoSection`; `spliceLines` and `joinLines`; `formatHead` and `escapeLinkText`.
- Produces (each takes a parsed `TodoFile` and returns the whole new text):
  - `insertItem(todo, group, index, lines)`. A missing group is appended at the end as `## <group>`.
  - `removeItem(todo, item)`, which never leaves a doubled blank line or a trailing blank line.
  - `replaceItem(todo, item, lines)`
  - `setItemHead(todo, item, id, title)` and `withHead(text: Lines, item, id, title): Lines`. They rewrite only the head, keeping the bullet, checkbox, body and link target.
  - `renameSection(todo, from, to)`
  - `formatTodoFile({ title, description? })`, a new `TODO.md`.

- [ ] **Step 1: Write the failing test**

Create `test/markdown/todoEdits.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/markdown/todoEdits.test.ts`
Expected: FAIL with `SyntaxError: Export named 'formatTodoFile' not found in module`.

- [ ] **Step 3: Write the edits**

In `src/markdown/todoFile.ts`, replace the `./items.ts` and `./lines.ts` import lines with:

```ts
import { escapeLinkText, formatHead, parseHead, unescapeLinkText } from "./items.ts"
import { isBlank, joinLines, type Lines, spliceLines, splitLines, trimBlock } from "./lines.ts"
```

Then append to the end of the file:

```ts
const lastContentLine = (lines: ReadonlyArray<string>, before: number): number => {
  let line = before - 1
  while (line >= 0 && isBlank(lines[line])) line--
  return line
}

/**
 * Inserts an item's lines as the `index`-th task of `group` (spec §2.10, add).
 * A missing group is appended as a `##` heading at the end of the file.
 */
export const insertItem = (
  todo: TodoFile,
  group: string | undefined,
  index: number,
  item: ReadonlyArray<string>,
): string => {
  const { lines } = todo.text
  const section = todo.sections.find((candidate) => candidate.name === group)
  if (section === undefined) {
    const last = lastContentLine(lines, lines.length)
    const insert = [...(last >= 0 ? [""] : []), `## ${group}`, "", ...item]
    return joinLines(spliceLines(todo.text, last + 1, lines.length - last - 1, insert))
  }
  if (section.items.length === 0) {
    const at = lastContentLine(lines, section.end) + 1
    const before = at > 0 ? [""] : []
    const after = at < lines.length && !isBlank(lines[at]) ? [""] : []
    return joinLines(spliceLines(todo.text, at, 0, [...before, ...item, ...after]))
  }
  const target = section.items[Math.max(0, index)]
  const at = target?.start ?? section.items.at(-1)?.end ?? section.end
  return joinLines(spliceLines(todo.text, at, 0, item))
}

/** Removes an item and its body, without leaving a doubled blank line behind. */
export const removeItem = (todo: TodoFile, item: TodoItem): string => {
  let text = spliceLines(todo.text, item.start, item.end - item.start, [])
  const at = item.start
  const blankBefore = at > 0 && isBlank(text.lines[at - 1])
  if (blankBefore && isBlank(text.lines[at])) text = spliceLines(text, at, 1, [])
  else if (blankBefore && at === text.lines.length) text = spliceLines(text, at - 1, 1, [])
  return joinLines(text)
}

/** Replaces an item and its body with new lines. */
export const replaceItem = (todo: TodoFile, item: TodoItem, lines: ReadonlyArray<string>): string =>
  joinLines(spliceLines(todo.text, item.start, item.end - item.start, lines))

/** Rewrites only an item's head (`<id> - <title>`), keeping its bullet, checkbox and link target. */
export const withHead = (text: Lines, item: TodoItem, id: TaskId, title: string): Lines => {
  const line = text.lines[item.start] ?? ""
  const head = formatHead(id, title)
  const rewritten =
    item.linkText === undefined
      ? line.slice(0, item.headColumn) + head
      : line.slice(0, item.linkText[0]) + escapeLinkText(head) + line.slice(item.linkText[1])
  return spliceLines(text, item.start, 1, [rewritten])
}

export const setItemHead = (todo: TodoFile, item: TodoItem, id: TaskId, title: string): string =>
  joinLines(withHead(todo.text, item, id, title))

/** Renames a group's heading in place (spec §2.10, renameGroup). */
export const renameSection = (todo: TodoFile, from: string, to: string): string => {
  const heading = todo.sections.find((section) => section.name === from)?.heading
  if (heading === undefined) return joinLines(todo.text)
  const line = todo.text.lines[heading.line] ?? ""
  return joinLines(
    spliceLines(todo.text, heading.line, 1, [
      line.slice(0, heading.from) + to + line.slice(heading.to),
    ]),
  )
}

/** A new `TODO.md` with a title and optional description. */
export const formatTodoFile = (options: {
  readonly title: string
  readonly description?: string
}): string => `# ${options.title}\n${options.description ? `\n${options.description}\n` : ""}`
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test test/markdown/todoEdits.test.ts test/markdown/todoFile.test.ts`
Expected: `29 pass`, `0 fail`.

- [ ] **Step 5: Run the gate and commit**

```bash
bun run check
git add src/markdown/todoFile.ts test/markdown/todoEdits.test.ts
git commit -m "Edit TODO.md with minimal diffs" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014ak6bnNqeftYod6YDrWkcK"
```

---

### Task 7: Task files

**Files:**
- Create: `src/markdown/taskFile.ts`
- Test: `test/markdown/taskFile.test.ts`

**Interfaces:**
- Consumes: `Comment`, `Diagnostic`, `TaskId` and `unique` from `spec`; `DateTime` and `Option` from `effect`; `ast.ts`, `frontmatter.ts`, `ids.ts` and `lines.ts`; `md` from the fixtures.
- Produces:
  - `interface TaskFileContent { title; tags; assignee?; dependsOn; extra; description; comments; group?; completedAt?: DateTime.Utc }`
  - `interface TaskFile extends Omit<TaskFileContent, "title"> { title: string | undefined; diagnostics }`
  - `parseTaskFile(source, file): TaskFile`. `file` is the root-relative path used in diagnostics; the function reports `invalid-frontmatter` and `invalid-comment`.
  - `formatTaskFile(content): string`
  - `interface TaskFileChanges` (absent means unchanged; `null` removes `assignee`, `group` or `completedAt`) and `updateTaskFile(source, changes): string`.
  - `prependComment(source, comment): string`
  - `formatInstant(at)` → `"2026-09-12T10:31:00Z"`, `formatTimestamp(at)` → `"2026-09-12 12:00 +00:00"`, and `parseCommentHeading(text)`.

- [ ] **Step 1: Write the failing test**

Create `test/markdown/taskFile.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/markdown/taskFile.test.ts`
Expected: FAIL with `Cannot find module '../../src/markdown/taskFile.ts'`.

- [ ] **Step 3: Write the task file module**

Create `src/markdown/taskFile.ts`:

```ts
import { DateTime, Option } from "effect"
import { type Comment, type Diagnostic, type TaskId, unique } from "../spec/index.ts"
import { headingText, lineSpan, parseAst } from "./ast.ts"
import { formatFrontmatter, readFrontmatter, setFrontmatterFields } from "./frontmatter.ts"
import { parseId } from "./ids.ts"
import { isBlank, joinLines, type Lines, spliceLines, splitLines, trimBlock } from "./lines.ts"

/** What a task file holds (spec §2.6). */
export interface TaskFileContent {
  readonly title: string
  readonly tags: ReadonlyArray<string>
  readonly assignee: string | undefined
  readonly dependsOn: ReadonlyArray<TaskId>
  readonly extra: Readonly<Record<string, unknown>>
  readonly description: string
  /** Newest first. */
  readonly comments: ReadonlyArray<Comment>
  /** Done files only. */
  readonly group: string | undefined
  readonly completedAt: DateTime.Utc | undefined
}

/** A parsed task file. `title` is `undefined` when the frontmatter has none. */
export interface TaskFile extends Omit<TaskFileContent, "title"> {
  readonly title: string | undefined
  readonly diagnostics: ReadonlyArray<Diagnostic>
}

const standardKeys = new Set(["title", "tags", "assignee", "depends_on", "completed_at", "group"])

/** `2026-09-12T10:31:00Z`: the frontmatter form of an instant. */
export const formatInstant = (at: DateTime.Utc): string =>
  DateTime.formatIso(at).replace(/\.\d{3}Z$/, "Z")

/** `2026-09-12 10:31 +00:00` (seconds only when not zero): the comment heading form. */
export const formatTimestamp = (at: DateTime.Utc): string => {
  const iso = DateTime.formatIso(at)
  const seconds = iso.slice(17, 19)
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}${seconds === "00" ? "" : `:${seconds}`} +00:00`
}

const commentHeading =
  /^@(\S+) at (\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\s*(Z|[+-]\d{2}:\d{2}))?$/

/** Reads a comment heading's `@author at <timestamp>` (spec §2.6). */
export const parseCommentHeading = (
  text: string,
): { readonly author: string; readonly at: DateTime.Utc } | undefined => {
  const [, author, date, time, offset] = commentHeading.exec(text) ?? []
  if (author === undefined || date === undefined || time === undefined) return undefined
  const seconds = time.length === 5 ? ":00" : ""
  const at = DateTime.make(`${date}T${time}${seconds}${offset ?? "Z"}`)
  return Option.isSome(at) ? { author, at: DateTime.toUtc(at.value) } : undefined
}

/** Where a task file's parts are, for parsing and editing. */
const layout = (source: string) => {
  const text = splitLines(source)
  const tree = parseAst(source)
  const yaml = tree.children[0]?.type === "yaml" ? tree.children[0] : undefined
  const bodyStart = yaml === undefined ? 0 : lineSpan(yaml).end
  const lastSection = tree.children
    .filter((node) => node.type === "heading" && node.depth === 2)
    .at(-1)
  const comments =
    lastSection?.type === "heading" && headingText(source, lastSection).text === "Comments"
      ? lineSpan(lastSection).start
      : undefined
  return { text, tree, yaml, bodyStart, comments }
}

/** Parses a task file. `file` (its root-relative path) locates diagnostics. Never fails. */
export const parseTaskFile = (source: string, file: string): TaskFile => {
  const { text, tree, yaml, bodyStart, comments: commentsLine } = layout(source)
  const diagnostics: Diagnostic[] = []
  const report = (code: string, message: string, line: number) =>
    diagnostics.push({ severity: "error", code, message, file, line })

  const { data, error } = readFrontmatter(yaml?.value ?? "")
  if (error !== undefined) report("invalid-frontmatter", error, 1)
  const invalid = (key: string, expected: string) =>
    report("invalid-frontmatter", `${key} must be ${expected}`, 1)

  const stringField = (key: string): string | undefined => {
    const value = data[key]
    if (value === undefined || value === null) return undefined
    if (typeof value === "string" && value.trim() !== "") return value
    invalid(key, "a non-empty string")
    return undefined
  }
  const list = <A>(key: string, expected: string, read: (value: unknown) => A | undefined): A[] => {
    const value = data[key]
    if (value === undefined || value === null) return []
    const values = (Array.isArray(value) ? value : [value]).map(read)
    if (values.every((item) => item !== undefined)) return unique(values) as A[]
    invalid(key, expected)
    return []
  }
  const tags = list("tags", "a list of strings", (value) =>
    typeof value === "string" && value.trim() !== "" ? value : undefined,
  )
  const dependsOn = list("depends_on", "a list of task IDs", (value) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      ? String(value)
      : typeof value === "string"
        ? parseId(value)
        : undefined,
  )
  const completedText = stringField("completed_at")
  const completedAt =
    completedText === undefined ? undefined : Option.getOrUndefined(DateTime.make(completedText))
  if (completedText !== undefined && completedAt === undefined)
    invalid("completed_at", "an ISO 8601 timestamp")

  const comments: Comment[] = []
  if (commentsLine !== undefined) {
    const headings = tree.children.filter(
      (node) => node.type === "heading" && node.depth === 3 && lineSpan(node).start > commentsLine,
    )
    headings.forEach((heading, index) => {
      if (heading.type !== "heading") return
      const { start, end } = lineSpan(heading)
      const next = headings[index + 1]
      const parsed = parseCommentHeading(headingText(source, heading).text)
      if (parsed === undefined) {
        report(
          "invalid-comment",
          "a comment heading must read `@<author> at <YYYY-MM-DD HH:mm>`",
          start + 1,
        )
        return
      }
      const body = trimBlock(
        text.lines.slice(end, next === undefined ? text.lines.length : lineSpan(next).start),
      )
      comments.push({ author: parsed.author, at: DateTime.toUtc(parsed.at), body })
    })
  }

  return {
    title: stringField("title"),
    tags,
    assignee: stringField("assignee"),
    dependsOn,
    extra: Object.fromEntries(Object.entries(data).filter(([key]) => !standardKeys.has(key))),
    description: trimBlock(text.lines.slice(bodyStart, commentsLine ?? text.lines.length)),
    comments,
    group: stringField("group"),
    completedAt: completedAt === undefined ? undefined : DateTime.toUtc(completedAt),
    diagnostics,
  }
}

const commentLines = (comment: Comment): string[] => [
  `### @${comment.author} at ${formatTimestamp(comment.at)}`,
  "",
  ...comment.body.split("\n"),
]

/** The frontmatter entries of `content`, in canonical order (spec §2.6). */
const entries = (content: Partial<TaskFileContent>): Array<readonly [string, unknown]> => [
  ...(content.title === undefined ? [] : [["title", content.title] as const]),
  ...(content.tags === undefined || content.tags.length === 0
    ? []
    : [["tags", [...content.tags]] as const]),
  ...(content.assignee === undefined ? [] : [["assignee", content.assignee] as const]),
  ...(content.dependsOn === undefined || content.dependsOn.length === 0
    ? []
    : [["depends_on", content.dependsOn.map(Number)] as const]),
  ...Object.entries(content.extra ?? {}),
  ...(content.group === undefined ? [] : [["group", content.group] as const]),
  ...(content.completedAt === undefined
    ? []
    : [["completed_at", formatInstant(content.completedAt)] as const]),
]

/** A new task file for `content` (spec §2.6). */
export const formatTaskFile = (content: TaskFileContent): string => {
  const blocks = [
    ...(content.description === "" ? [] : [content.description.split("\n")]),
    ...(content.comments.length === 0
      ? []
      : [
          ["## Comments", ...content.comments.flatMap((comment) => ["", ...commentLines(comment)])],
        ]),
  ]
  const body = blocks.flatMap((block, index) => (index === 0 ? block : ["", ...block]))
  return `${["---", ...formatFrontmatter(entries(content)), "---", ...body].join("\n")}\n`
}

/**
 * Changes to a task file. Absent fields are unchanged; `null` removes
 * `assignee`, `group` or `completed_at`.
 */
export interface TaskFileChanges {
  readonly title?: string
  readonly tags?: ReadonlyArray<string>
  readonly assignee?: string | null
  readonly dependsOn?: ReadonlyArray<TaskId>
  readonly extra?: Readonly<Record<string, unknown>>
  readonly description?: string
  readonly group?: string | null
  readonly completedAt?: DateTime.Utc | null
}

/** Applies `changes`, rewriting only the frontmatter keys and description that change (spec §2.10). */
export const updateTaskFile = (source: string, changes: TaskFileChanges): string => {
  const current = parseTaskFile(source, "")
  const { yaml, bodyStart, comments } = layout(source)
  let text: Lines = splitLines(source)

  if (changes.description !== undefined && changes.description !== current.description) {
    const end = comments ?? text.lines.length
    const block = changes.description === "" ? [] : changes.description.split("\n")
    const lines = comments !== undefined && block.length > 0 ? [...block, ""] : block
    text = spliceLines(text, bodyStart, end - bodyStart, lines)
  }

  const fields: Record<string, unknown> = {}
  if (changes.title !== undefined) fields.title = changes.title
  if (changes.tags !== undefined)
    fields.tags = changes.tags.length === 0 ? undefined : [...changes.tags]
  if (changes.assignee !== undefined) fields.assignee = changes.assignee ?? undefined
  if (changes.dependsOn !== undefined) {
    fields.depends_on = changes.dependsOn.length === 0 ? undefined : changes.dependsOn.map(Number)
  }
  if (changes.extra !== undefined) {
    for (const key of Object.keys(current.extra)) fields[key] = undefined
    Object.assign(fields, changes.extra)
  }
  if (changes.group !== undefined) fields.group = changes.group ?? undefined
  if (changes.completedAt !== undefined) {
    fields.completed_at =
      changes.completedAt === null ? undefined : formatInstant(changes.completedAt)
  }

  if (Object.keys(fields).length > 0) {
    if (yaml !== undefined) {
      text = spliceLines(text, 1, lineSpan(yaml).end - 2, setFrontmatterFields(yaml.value, fields))
    } else {
      const added = Object.entries(fields).filter(([, value]) => value !== undefined)
      if (added.length > 0)
        text = spliceLines(text, 0, 0, ["---", ...formatFrontmatter(added), "---"])
    }
  }
  return joinLines(text)
}

/** Adds a comment at the top of the comments section, creating the section if needed (spec §2.10). */
export const prependComment = (source: string, comment: Comment): string => {
  const { text, comments } = layout(source)
  const entry = commentLines(comment)
  if (comments !== undefined) {
    const next = text.lines[comments + 1]
    const after = next !== undefined && !isBlank(next) ? [""] : []
    return joinLines(spliceLines(text, comments + 1, 0, ["", ...entry, ...after]))
  }
  let last = text.lines.length - 1
  while (last >= 0 && isBlank(text.lines[last])) last--
  const insert = [...(last >= 0 ? [""] : []), "## Comments", "", ...entry]
  return joinLines(spliceLines(text, last + 1, text.lines.length - last - 1, insert))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test test/markdown/taskFile.test.ts`
Expected: `21 pass`, `0 fail`.

- [ ] **Step 5: Run the gate and commit**

```bash
bun run check
git add src/markdown/taskFile.ts test/markdown/taskFile.test.ts
git commit -m "Parse, write and edit todo.md task files" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014ak6bnNqeftYod6YDrWkcK"
```

---

### Task 8: Model conversion and normalization

**Files:**
- Create: `src/markdown/convert.ts`, `src/markdown/normalize.ts`
- Test: `test/markdown/convert.test.ts`, `test/markdown/normalize.test.ts`

**Interfaces:**
- Consumes: `Task`, `TaskId`, `TaskStatus` and `Diagnostic` from `spec`; Tasks 2–7.
- Produces:
  - `inlineTask(item, id, group): Task`. A checked item has `status: "done"` and no `completedAt`.
  - `fileTask(id, file, { title, status, group }): Task`. `title` is the fallback when the frontmatter has none.
  - `fieldsOf(task)`, `fitsInline(task)`, `inlineItemFor(task)`, `linkedItemFor(task, path)`
  - `taskFileFor(task): TaskFileContent`, which writes `group` and `completedAt` only for done tasks.
  - `normalize(todo, { usedIds, titles: Map<path, title> }): { text; assigned; checked }`
  - `staleLinkText(item, title): Diagnostic | undefined`

- [ ] **Step 1: Write the failing tests**

Create `test/markdown/convert.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { DateTime } from "effect"
import {
  fileTask,
  fitsInline,
  inlineItemFor,
  inlineTask,
  linkedItemFor,
  taskFileFor,
} from "../../src/markdown/convert.ts"
import { formatTaskFile, parseTaskFile } from "../../src/markdown/taskFile.ts"
import { findItem, parseTodoFile } from "../../src/markdown/todoFile.ts"
import type { Task } from "../../src/spec/index.ts"

const task: Task = {
  id: "3",
  title: "Fix login redirect",
  description: "Users land on /home.",
  status: "open",
  tags: ["bug"],
  assignee: "lemol",
  dependsOn: ["1"],
  comments: [],
  group: "Backend",
  completedAt: undefined,
  extra: { estimate: 3 },
}

describe("inline tasks", () => {
  test("an inline item round-trips through the model", () => {
    const todo = parseTodoFile(`## Backend\n\n${inlineItemFor(task).join("\n")}\n`)
    const item = findItem(todo, "3")
    if (item === undefined) throw new Error("no item")
    expect(inlineTask(item, "3", "Backend")).toEqual(task)
  })

  test("a checked item is done", () => {
    const todo = parseTodoFile("- [x] 03 - Fix login redirect\n")
    const item = findItem(todo, "3")
    if (item === undefined) throw new Error("no item")
    expect(inlineTask(item, "3", undefined)).toMatchObject({
      status: "done",
      completedAt: undefined,
    })
  })

  test("fitsInline requires no comments and single-token fields", () => {
    expect(fitsInline(task)).toBe(true)
    expect(fitsInline({ ...task, tags: ["needs review"] })).toBe(false)
    expect(
      fitsInline({ ...task, comments: [{ author: "a", at: DateTime.makeUnsafe(0), body: "Hi." }] }),
    ).toBe(false)
  })
})

describe("file-backed tasks", () => {
  test("a task file round-trips through the model", () => {
    const file = parseTaskFile(
      formatTaskFile(taskFileFor(task)),
      "backend/03-fix-login-redirect.md",
    )
    expect(fileTask("3", file, { title: "ignored", status: "open", group: "Backend" })).toEqual(
      task,
    )
  })

  test("the link text is the fallback title", () => {
    const file = parseTaskFile("Notes.\n", "03-notes.md")
    expect(
      fileTask("3", file, { title: "From the link", status: "open", group: undefined }).title,
    ).toBe("From the link")
  })

  test("only done tasks write group and completion time", () => {
    expect(taskFileFor(task)).toMatchObject({ group: undefined, completedAt: undefined })
    const at = DateTime.makeUnsafe("2026-09-12T10:31:00Z")
    expect(taskFileFor({ ...task, status: "done", completedAt: at })).toMatchObject({
      group: "Backend",
      completedAt: at,
    })
  })

  test("linkedItemFor links to the file", () => {
    expect(linkedItemFor(task, "backend/03-fix-login-redirect.md")).toEqual([
      "- [ ] [03 - Fix login redirect](./backend/03-fix-login-redirect.md)",
    ])
  })
})
```

Create `test/markdown/normalize.test.ts`:

```ts
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
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/markdown/convert.test.ts test/markdown/normalize.test.ts`
Expected: FAIL with `Cannot find module` for `convert.ts` and `normalize.ts`.

- [ ] **Step 3: Write the conversion**

Create `src/markdown/convert.ts`:

```ts
import type { Task, TaskId, TaskStatus } from "../spec/index.ts"
import { formatInlineItem, formatLinkedItem } from "./items.ts"
import { fitsMetadataLine, type InlineFields } from "./metadata.ts"
import type { TaskFile, TaskFileContent } from "./taskFile.ts"
import type { TodoItem } from "./todoFile.ts"

/** The model task for an inline item. A checked item is done, with no completion time yet. */
export const inlineTask = (item: TodoItem, id: TaskId, group: string | undefined): Task => ({
  id,
  title: item.title,
  description: item.description,
  status: item.checked ? "done" : "open",
  tags: item.fields.tags,
  assignee: item.fields.assignee,
  dependsOn: item.fields.dependsOn,
  comments: [],
  group,
  completedAt: undefined,
  extra: item.fields.extra,
})

/**
 * The model task for a task file. `title` is the fallback when the frontmatter
 * has none (the link text); `group` is the `TODO.md` section for open tasks and
 * the recorded `group` for done ones.
 */
export const fileTask = (
  id: TaskId,
  file: TaskFile,
  options: {
    readonly title: string
    readonly status: TaskStatus
    readonly group: string | undefined
  },
): Task => ({
  id,
  title: file.title ?? options.title,
  description: file.description,
  status: options.status,
  tags: file.tags,
  assignee: file.assignee,
  dependsOn: file.dependsOn,
  comments: file.comments,
  group: options.group,
  completedAt: file.completedAt,
  extra: file.extra,
})

export const fieldsOf = (task: Task): InlineFields => ({
  tags: task.tags,
  assignee: task.assignee,
  dependsOn: task.dependsOn,
  extra: task.extra,
})

/** Whether a task can be written inline: no comments, and fields that fit a metadata line (spec §2.9). */
export const fitsInline = (task: Task): boolean =>
  task.comments.length === 0 && fitsMetadataLine(fieldsOf(task))

/** The inline item for a task. Requires `fitsInline(task)`. */
export const inlineItemFor = (task: Task): string[] =>
  formatInlineItem({
    id: task.id,
    title: task.title,
    fields: fieldsOf(task),
    description: task.description,
  })

/** The linked item for a task whose file is at `path` (root-relative). */
export const linkedItemFor = (task: Task, path: string): string[] =>
  formatLinkedItem({ id: task.id, title: task.title, path })

/** The task file content for a task; `group` and `completedAt` are written only for done tasks. */
export const taskFileFor = (task: Task): TaskFileContent => ({
  title: task.title,
  tags: task.tags,
  assignee: task.assignee,
  dependsOn: task.dependsOn,
  extra: task.extra,
  description: task.description,
  comments: task.comments,
  group: task.status === "done" ? task.group : undefined,
  completedAt: task.status === "done" ? task.completedAt : undefined,
})
```

- [ ] **Step 4: Write the normalization**

Create `src/markdown/normalize.ts`:

```ts
import type { Diagnostic, TaskId } from "../spec/index.ts"
import { nextId } from "./ids.ts"
import { joinLines } from "./lines.ts"
import { allItems, type TodoFile, type TodoItem, withHead } from "./todoFile.ts"

export interface NormalizeContext {
  /** IDs used outside `TODO.md`: task and done file names (spec §2.7). */
  readonly usedIds: Iterable<TaskId>
  /** Frontmatter titles of linked task files, by root-relative path. */
  readonly titles: ReadonlyMap<string, string>
}

export interface Normalized {
  readonly text: string
  /** IDs given to items that had none, in document order. */
  readonly assigned: ReadonlyArray<TaskId>
  /** IDs of checked items, for the caller to complete. */
  readonly checked: ReadonlyArray<TaskId>
}

/**
 * The text-only steps of normalization (spec §2.11): assigns IDs to items
 * without one (step 1) and syncs link text with task file titles (step 4).
 * Finishing interrupted completions (step 2) and sweeping checked items
 * (step 3) move files, so the caller does them; `checked` lists the items.
 * Only the heads that change are rewritten.
 */
export const normalize = (todo: TodoFile, context: NormalizeContext): Normalized => {
  const items = allItems(todo)
  const used = [
    ...context.usedIds,
    ...items.flatMap((item) => (item.id === undefined ? [] : [item.id])),
  ]
  const assigned: TaskId[] = []
  const checked: TaskId[] = []
  let text = todo.text
  for (const item of items) {
    const id = item.id ?? nextId([...used, ...assigned])
    if (item.id === undefined) assigned.push(id)
    const title =
      (item.path === undefined ? undefined : context.titles.get(item.path)) ?? item.title
    if (id !== item.id || title !== item.title) text = withHead(text, item, id, title)
    if (item.checked) checked.push(id)
  }
  return { text: joinLines(text), assigned, checked }
}

/** A `stale-link-text` diagnostic when a linked item's text differs from its file's title. */
export const staleLinkText = (item: TodoItem, title: string): Diagnostic | undefined =>
  item.linked && item.id !== undefined && item.title !== title
    ? {
        severity: "info",
        code: "stale-link-text",
        message: `link text "${item.title}" differs from the title "${title}"`,
        taskId: item.id,
        file: "TODO.md",
        line: item.start + 1,
      }
    : undefined
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test test/markdown/convert.test.ts test/markdown/normalize.test.ts`
Expected: `11 pass`, `0 fail`.

- [ ] **Step 6: Run the gate and commit**

```bash
bun run check
git add src/markdown/convert.ts src/markdown/normalize.ts test/markdown/convert.test.ts test/markdown/normalize.test.ts
git commit -m "Convert between the todo.md format and the model, and normalize lists" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014ak6bnNqeftYod6YDrWkcK"
```

---

### Task 9: Public entry point, spec clarifications and docs

**Files:**
- Modify: `src/markdown/index.ts` (replace the `export {}` placeholder)
- Modify: `src/markdown/README.md`, `docs/architecture.md`, `docs/spec.md`
- Test: `test/markdown/index.test.ts`

**Interfaces:**
- Consumes: every module above.
- Produces: `@lemol/todo-md/markdown`, which re-exports `convert`, `ids`, `items`, `metadata`, `normalize`, `paths`, `taskFile` and `todoFile`. `lines`, `frontmatter` and `ast` stay internal.

- [ ] **Step 1: Write the failing test**

Create `test/markdown/index.test.ts`:

```ts
import { expect, test } from "bun:test"
import * as markdown from "../../src/markdown/index.ts"

test("the public entry point exposes parsing, editing, conversion and normalization", () => {
  for (const name of [
    "parseTodoFile",
    "insertItem",
    "removeItem",
    "replaceItem",
    "setItemHead",
    "renameSection",
    "formatTodoFile",
    "parseTaskFile",
    "formatTaskFile",
    "updateTaskFile",
    "prependComment",
    "parseMetadataLine",
    "inlineTask",
    "fileTask",
    "fitsInline",
    "normalize",
    "taskPath",
    "nextId",
  ]) {
    expect(typeof (markdown as Record<string, unknown>)[name]).toBe("function")
  }
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/markdown/index.test.ts`
Expected: FAIL with `Expected: "function"`, `Received: "undefined"`.

- [ ] **Step 3: Write the entry point**

Replace the contents of `src/markdown/index.ts` with:

```ts
export * from "./convert.ts"
export * from "./ids.ts"
export * from "./items.ts"
export * from "./metadata.ts"
export * from "./normalize.ts"
export * from "./paths.ts"
export * from "./taskFile.ts"
export * from "./todoFile.ts"
```

Run: `bun test test/markdown/index.test.ts`
Expected: `1 pass`, `0 fail`.

- [ ] **Step 4: Record the plan's decisions in the spec**

In `docs/spec.md`, make these five edits:

1. In §2.3, after the bullet that begins `- Group names MUST be unique`, add:

   ```markdown
   - A level-2 heading with no text is ordinary content, not a group.
   ```

2. In §2.4, replace the bullet that begins `- **Bullet.**` with:

   ```markdown
   - **Bullet.** Parsers accept `-`, `*` and `+`; writers use `-`. As in GFM, the
     checkbox must be followed by a space, and an item with no text after the
     checkbox is ordinary content.
   ```

3. In §2.8, replace step 3 of the slug list (the line beginning `3. Replacing each run of non-alphanumeric characters`) with:

   ```markdown
     3. Replacing each run of characters other than ASCII letters and digits
        with `-`.
   ```

4. In §2.6, after the bullet that begins `- The body extends to the next level-3 heading`, add:

   ```markdown
   - A level-3 heading in the comments section that does not match the form
     above is an `invalid-comment` diagnostic (error), and its body is not read
     as a comment.
   ```

5. In the §2.12 table, add this row after the `invalid-frontmatter` row:

   ```markdown
   | `invalid-comment`        | error    | §2.6    |
   ```

- [ ] **Step 5: Update the module docs**

Replace `src/markdown/README.md` with:

```markdown
# @lemol/todo-md/markdown

Pure parser and writer for the
[todo.md file format](../../docs/spec.md#part-2-the-todomd-format): `TODO.md`
and task files in, model and edited text out. It does no I/O; the `fs`
adapter reads and writes the files.

> Status: implemented for spec 0.1.

## Contents

| Area | Exports |
| --- | --- |
| `TODO.md` | `parseTodoFile(text)` → `TodoFile`: config, title, description, sections (ungrouped first) with their `TodoItem`s, and diagnostics. `allItems`, `findItem`, `sectionOf`. |
| `TODO.md` edits | `insertItem`, `removeItem`, `replaceItem`, `setItemHead`, `renameSection` (each returns the new text), `formatTodoFile` for a new list. |
| Task files | `parseTaskFile(text, file)` → `TaskFile`. `formatTaskFile(content)` for a new file; `updateTaskFile(text, changes)` and `prependComment(text, comment)` for edits. |
| Items | `formatInlineItem`, `formatLinkedItem`, `parseHead`, `formatHead`. |
| Metadata line | `parseMetadataLine`, `formatMetadataLine`, `fitsMetadataLine` (spec §2.5). |
| Model | `inlineTask`, `fileTask` (format → `Task`); `fitsInline`, `inlineItemFor`, `linkedItemFor`, `taskFileFor` (`Task` → format). |
| Normalization | `normalize(todo, context)`: assigns IDs and syncs link text, and lists checked items for the caller to complete (spec §2.11). `staleLinkText`. |
| Conventions | `parseId`, `formatId`, `nextId`, `isId` (spec §2.7); `slug`, `groupSlug`, `taskPath`, `resolveLink`, `linkTarget`, `normalizePath`, `joinPath`, `basename`, `dirname` (spec §2.8). |
| Timestamps | `formatInstant` (frontmatter), `formatTimestamp` and `parseCommentHeading` (comments). |

## How it works

- **Reading:** `mdast-util-from-markdown` with the GFM task-list and
  frontmatter extensions finds headings, lists, links and code blocks
  (CommonMark rules), with the line range of every node. Titles, metadata and
  descriptions are then read from the source lines themselves, so nothing is
  lost to re-rendering.
- **Writing:** every edit replaces a line range and returns the new text. Only
  the lines an operation is about change (spec §2.10); new lines use the
  canonical forms. Nothing is ever re-serialized from the AST.
- **Frontmatter:** read with `yaml`. Edits rewrite only the lines of the keys
  whose value changes, so comments, quoting and key order elsewhere survive.
- **Line endings:** CRLF files stay CRLF.

It runs anywhere JavaScript runs (Bun, Node, browsers).

## Who reports what

`parseTodoFile` and `parseTaskFile` report the diagnostics that need only
the text:

- **`TODO.md`:** `invalid-frontmatter`, `duplicate-group`, `outside-root`,
  `id-mismatch`, `linked-body`, `reserved-field`, `multiple-assignees`,
  `invalid-metadata`, `missing-id`, `checked-item`.
- **Task files:** `invalid-frontmatter`, `invalid-comment`.

`staleLinkText` builds `stale-link-text`. The `fs` adapter reports the
diagnostics that need the file system: `broken-link`, `orphan-file`,
`interrupted-completion`, `duplicate-id`.

## Testing

Each file in `src/markdown` has a test file in `test/markdown`. Edits are
tested against exact expected text, so every test also checks that nothing
else changed.

## May import (enforced by `test/boundaries.test.ts`)

- [`spec`](../spec)
- `effect`
- `mdast-util-from-markdown`, `mdast-util-frontmatter`,
  `mdast-util-gfm-task-list-item` and the matching `micromark-extension-*`
  packages
- `yaml`

## Not here

- Reading or writing files, locking: see [`fs`](../fs).
```

In `docs/architecture.md`, in the `## markdown` section, replace everything from the bullet `- **The parse result is the model plus a source map.**` through the bullet `- **Tests are golden fixtures:** …` with:

```markdown
- **The parse result records where everything is.** Each section and item
  keeps its line range, so edits know exactly which lines to replace.
  Titles, metadata and descriptions are read from the source lines, not
  re-rendered from the AST.
- **Writing splices lines; it never re-serializes.** Edits such as
  `insertItem`, `removeItem`, `replaceItem`, `setItemHead`, `updateTaskFile`
  and `prependComment` replace only the lines involved, and new lines come
  from small canonical templates. This is how the spec's minimal-diff rule
  (§2.10) holds. `remark-stringify` is deliberately not used, because it
  rewrites the whole document.
- **Frontmatter edits rewrite only the changed keys' lines**, using the
  source ranges `yaml` reports, so comments and formatting elsewhere survive.
- **It also owns:**
  - the text-only steps of normalization (assigning IDs, syncing link text);
    the `fs` adapter does the steps that move files;
  - slugs, paths and ID formatting;
  - the metadata-line grammar;
  - converting between the format and the model;
  - the diagnostics that need only the text.
- **It doesn't depend on Bun or Node**, so a browser (the web app) or a
  GitHub-backed adapter can reuse it.
- **Tests compare exact text:** each edit's test states the whole expected
  output, so it also proves nothing else changed.
```

- [ ] **Step 6: Run the gate and commit**

Run: `bun run check`
Expected: lint and typecheck clean; `174 pass`, `0 fail` (61 `spec` + 113 `markdown`).

```bash
git add src/markdown/index.ts test/markdown/index.test.ts src/markdown/README.md docs/architecture.md docs/spec.md
git commit -m "Expose the markdown module and record its format decisions in the spec" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014ak6bnNqeftYod6YDrWkcK"
```
