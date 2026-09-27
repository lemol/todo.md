import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { doneTask, entryTask, isInterrupted, readSnapshot } from "../../src/fs/snapshot.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { diskWith, filesOnDisk, md, parserOnDisk } from "./helpers.ts"

const snapshot = Effect.flatMap(Effect.all([filesOnDisk, parserOnDisk]), ([files, parser]) =>
  readSnapshot(files, parser),
)

const codes = Effect.map(snapshot, (s) =>
  s.diagnostics.map((d) => [d.code, d.severity, d.taskId ?? d.file]),
)

const rateLimiting = md("---", "title: Add rate limiting", "tags: [api]", "---", "Token bucket.")

describe("readSnapshot", () => {
  effectTest(
    "reads items with their task files, done files and the IDs in use",
    Effect.gen(function* () {
      const s = yield* snapshot
      expect(s.entries.map(entryTask).map((t) => [t.id, t.title, t.group, t.tags])).toEqual([
        ["1", "Write changelog", undefined, []],
        ["2", "Add rate limiting", "Backend", ["api"]],
      ])
      expect(s.done.map(doneTask).map((t) => [t.id, t.title, t.status, t.group])).toEqual([
        ["3", "Fix login", "done", "Backend"],
      ])
      expect([...s.usedIds].sort()).toEqual(["1", "2", "3", "9"])
      expect(s.titles).toEqual(new Map([["backend/02-add-rate-limiting.md", "Add rate limiting"]]))
    }),
    diskWith({
      "TODO.md": md(
        "- [ ] 01 - Write changelog",
        "",
        "## Backend",
        "",
        "- [ ] [02 - Rate limits](./backend/02-add-rate-limiting.md)",
      ),
      "backend/02-add-rate-limiting.md": rateLimiting,
      "backend/09-orphan.md": md("---", "title: Orphan", "---"),
      "done/backend/03-fix-login.md": md(
        "---",
        "title: Fix login",
        "group: Backend",
        "completed_at: 2026-09-12T10:31:00Z",
        "---",
      ),
    }),
  )

  effectTest(
    "fails when the list has no TODO.md",
    Effect.gen(function* () {
      const error = yield* Effect.flip(snapshot)
      expect(error.message).toContain("no TODO.md")
    }),
    diskWith({}),
  )
})

describe("snapshot diagnostics", () => {
  effectTest(
    "report broken links",
    Effect.gen(function* () {
      expect(yield* codes).toEqual([["broken-link", "error", "1"]])
    }),
    diskWith({ "TODO.md": md("- [ ] [01 - Missing](./01-missing.md)") }),
  )

  effectTest(
    "report task files that no item links to",
    Effect.gen(function* () {
      expect(yield* codes).toEqual([["orphan-file", "warning", "backend/05-lost.md"]])
    }),
    diskWith({
      "TODO.md": md("## Backend"),
      "backend/05-lost.md": md("---", "title: Lost", "---"),
    }),
  )

  effectTest(
    "report duplicate IDs, in TODO.md or across open and done",
    Effect.gen(function* () {
      expect(yield* codes).toEqual([
        ["duplicate-id", "error", "1"],
        ["duplicate-id", "error", "2"],
      ])
    }),
    diskWith({
      "TODO.md": md("- [ ] 01 - A", "- [ ] 01 - B", "- [ ] 02 - Something else"),
      "done/02-add-rate-limiting.md": rateLimiting,
    }),
  )

  effectTest(
    "report an interrupted completion",
    Effect.gen(function* () {
      expect(yield* codes).toEqual([["interrupted-completion", "warning", "2"]])
    }),
    diskWith({
      "TODO.md": md("- [ ] [02 - Add rate limiting](./02-add-rate-limiting.md)"),
      "done/02-add-rate-limiting.md": rateLimiting,
    }),
  )

  effectTest(
    "include the task files' own problems and stale link text",
    Effect.gen(function* () {
      expect(yield* codes).toEqual([
        ["invalid-comment", "error", "01-a.md"],
        ["stale-link-text", "info", "1"],
      ])
    }),
    diskWith({
      "TODO.md": md("- [ ] [01 - Old](./01-a.md)"),
      "01-a.md": md("---", "title: A", "---", "## Comments", "", "### a note"),
    }),
  )
})

describe("isInterrupted", () => {
  effectTest(
    "returns true when an entry has a matching done file, and false otherwise",
    Effect.gen(function* () {
      const s = yield* snapshot
      const [first, second] = s.entries
      expect(first && isInterrupted(s, first)).toBe(true)
      expect(second && isInterrupted(s, second)).toBe(false)
    }),
    diskWith({
      "TODO.md": md(
        "- [ ] [02 - Add rate limiting](./02-add-rate-limiting.md)",
        "- [ ] 03 - Still open",
      ),
      "done/02-add-rate-limiting.md": rateLimiting,
    }),
  )
})
