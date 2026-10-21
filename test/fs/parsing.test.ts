import { describe, expect, test } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { keyOf, makeParser } from "../../src/fs/parsing.ts"
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

describe("keyOf", () => {
  test("keys a parse by path, length and Bun.hash of the text", () => {
    expect(keyOf("01-a.md", withComment)).toBe(`01-a.md:197:${Bun.hash(withComment).toString(36)}`)
    expect(keyOf("01-a.md", withComment)).toBe("01-a.md:197:z484hkxqy8ou")
  })
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
    "overlapping reads keep each other's parses",
    Effect.gen(function* () {
      const parser = yield* parserWith()
      const files = { "01-a.md": withComment, "02-b.md": withComment.replace("api", "web") }
      const [a, b] = yield* read(parser, files)

      // Two reads in flight, ending out of order: the first `end` must not
      // forget what the read still running has used.
      yield* parser.begin
      yield* parser.begin
      parser.taskFile("01-a.md", files["01-a.md"])
      yield* parser.end
      parser.taskFile("02-b.md", files["02-b.md"])
      yield* parser.end
      const [againA, againB] = yield* read(parser, files)

      expect(againA).toBe(a)
      expect(againB).toBe(b)
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

      // Named after the root's cyrb53 hash, which must not change: a new
      // name would orphan every cache file until its list is gone.
      expect(cacheFile).toBe("cache/1zxjo77c9fm.json")
      const cached = (yield* disk.read(cacheFile ?? "")).replace("Token bucket.", "From the cache")

      yield* disk.write(cacheFile ?? "", cached)
      const [fromCache] = yield* read(yield* parserWith(), { "01-a.md": withComment })

      expect(fromCache?.description).toBe("From the cache")
    }),
    diskWith({}),
  )

  effectTest(
    "misses an entry under the old cyrb53 key, and saves it under the new one",
    Effect.gen(function* () {
      const disk = yield* Disk

      yield* read(yield* parserWith(), { "01-a.md": withComment })
      const [cacheFile] = yield* disk.tree()
      const key = keyOf("01-a.md", withComment)
      const cached = (yield* disk.read(cacheFile ?? "")).replace("Token bucket.", "From the cache")

      yield* disk.write(cacheFile ?? "", cached.replace(key, "01-a.md:197:1woid7foeyd"))
      const [missed] = yield* read(yield* parserWith(), { "01-a.md": withComment })

      expect(missed?.description).toBe("Token bucket.")
      const saved = JSON.parse(yield* disk.read(cacheFile ?? ""))

      expect(Object.keys(saved.entries)).toEqual([key])
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
    "a save drops the cache files of lists that are gone, and keeps the rest",
    Effect.gen(function* () {
      const disk = yield* Disk

      const cacheOf = (root: string) => `{"version":1,"root":${JSON.stringify(root)},"entries":{}}`

      yield* disk.write("cache/gone.json", cacheOf(`${disk.root}/removed-worktree`))
      yield* disk.write("cache/live.json", cacheOf(disk.root))
      yield* disk.write("cache/unreadable.json", "{ not json")
      yield* disk.write("cache/notes.txt", cacheOf("/nowhere"))
      yield* read(yield* parserWith(), { "01-a.md": withComment })
      const tree = yield* disk.tree()

      // The fourth is the parser's own: its list, `/list`, does not exist
      // either, but a save never drops the file it has just written.
      expect(tree).toHaveLength(4)
      expect(tree).toEqual(
        expect.arrayContaining(["cache/live.json", "cache/unreadable.json", "cache/notes.txt"]),
      )
      expect(tree).not.toContain("cache/gone.json")
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
