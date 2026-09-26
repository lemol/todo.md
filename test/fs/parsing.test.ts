import { describe, expect } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { makeParser } from "../../src/fs/parsing.ts"
import { parseTaskFile } from "../../src/markdown/index.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, diskWith, md } from "./helpers.ts"

const withComment = md(
  "---",
  "title: Add rate limiting",
  "tags: [api]",
  "depends_on: [3]",
  "estimate: { points: 3 }",
  "completed_at: 2026-09-12T10:31:00Z",
  "---",
  "Token bucket.",
  "",
  "## Comments",
  "",
  "### @ana at 2026-09-12 10:31 +00:00",
  "",
  "Looks good.",
)

/** A parser for a list at `/list`, keeping its cache file in the temporary directory. */
const parserWith = (root = "/list") =>
  Effect.gen(function* () {
    const disk = yield* Disk
    return yield* makeParser(root, `${disk.root}/cache`).pipe(Effect.provide(BunServices.layer))
  })

/** One read of `files`, as `readSnapshot` does it. */
const read = (
  parser: Effect.Success<ReturnType<typeof parserWith>>,
  files: Readonly<Record<string, string>>,
) =>
  Effect.gen(function* () {
    yield* parser.begin
    const parsed = Object.entries(files).map(([path, text]) => parser.taskFile(path, text))
    yield* parser.end
    return parsed
  })

describe("makeParser", () => {
  effectTest(
    "reuses the parse of an unchanged file, and parses an edited one again",
    Effect.gen(function* () {
      const parser = yield* parserWith()
      const [first] = yield* read(parser, { "01-a.md": withComment })
      const [again] = yield* read(parser, { "01-a.md": withComment })
      expect(again).toBe(first)
      const edited = withComment.replace("Token bucket.", "Leaky bucket.")
      const [changed] = yield* read(parser, { "01-a.md": edited })
      expect(changed?.description).toBe("Leaky bucket.")
      const [moved] = yield* read(parser, { "done/01-a.md": withComment })
      expect(moved).not.toBe(first)
    }),
    diskWith({}),
  )

  effectTest(
    "keeps parses in the cache file, for the next parser of the same list",
    Effect.gen(function* () {
      const disk = yield* Disk
      yield* read(yield* parserWith(), { "01-a.md": withComment })
      const [restored] = yield* read(yield* parserWith(), { "01-a.md": withComment })
      expect(restored).toEqual(parseTaskFile(withComment, "01-a.md"))

      // The next parser takes the cached parse rather than parsing again.
      const [cacheFile] = yield* disk.tree()
      const cached = (yield* disk.read(cacheFile ?? "")).replace("Token bucket.", "From the cache")
      yield* disk.write(cacheFile ?? "", cached)
      const [fromCache] = yield* read(yield* parserWith(), { "01-a.md": withComment })
      expect(fromCache?.description).toBe("From the cache")
    }),
    diskWith({}),
  )

  effectTest(
    "ignores a cache file it cannot read, and one for another list",
    Effect.gen(function* () {
      const disk = yield* Disk
      yield* read(yield* parserWith(), { "01-a.md": withComment })
      const [cacheFile] = yield* disk.tree()
      const cached = (yield* disk.read(cacheFile ?? "")).replace("Token bucket.", "From the cache")

      yield* disk.write(cacheFile ?? "", cached.replace('"root":"/list"', '"root":"/other"'))
      const [otherList] = yield* read(yield* parserWith(), { "01-a.md": withComment })
      expect(otherList?.description).toBe("Token bucket.")

      yield* disk.write(cacheFile ?? "", "{ not json")
      const [unreadable] = yield* read(yield* parserWith(), { "01-a.md": withComment })
      expect(unreadable?.description).toBe("Token bucket.")
    }),
    diskWith({}),
  )

  effectTest(
    "parses a file JSON cannot hold every time, and caches the others",
    Effect.gen(function* () {
      const disk = yield* Disk
      const infinite = md("---", "title: Far", "distance: .inf", "---")
      const files = { "01-a.md": withComment, "02-far.md": infinite }
      yield* read(yield* parserWith(), files)
      const [cacheFile] = yield* disk.tree()
      const cached = yield* disk.read(cacheFile ?? "")
      expect(cached).toContain("01-a.md")
      expect(cached).not.toContain("02-far.md")
      const [, far] = yield* read(yield* parserWith(), files)
      expect(far?.extra).toEqual({ distance: Number.POSITIVE_INFINITY })
    }),
    diskWith({}),
  )
})
