import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { normalizeList } from "../../src/fs/normalization.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, diskWith, filesOnDisk, md } from "./helpers.ts"

const normalizeDisk = Effect.flatMap(filesOnDisk, normalizeList)

const rateLimiting = md("---", "title: Add rate limiting", "---", "Token bucket.")

describe("normalizeList", () => {
  effectTest(
    "numbers new items, syncs link text and completes ticked items",
    Effect.gen(function* () {
      const disk = yield* Disk
      yield* TestClock.setTime(Date.parse("2026-09-12T10:31:00Z"))
      expect(yield* normalizeDisk).toEqual({ assigned: ["4"], finished: [], swept: ["2"] })
      expect(yield* disk.read("TODO.md")).toBe(
        md(
          "* [ ] 01 - Kept as written",
          "- [ ] 04 - Buy milk",
          "",
          "A note.",
          "",
          "- [ ] [03 - New title](./03-x.md)",
        ),
      )
      expect(yield* disk.read("done/02-ticked-by-hand.md")).toBe(
        md("---", "title: Ticked by hand", "completed_at: 2026-09-12T10:31:00Z", "---"),
      )
    }),
    diskWith({
      "TODO.md": md(
        "* [ ] 01 - Kept as written",
        "- [ ] Buy milk",
        "",
        "A note.",
        "",
        "- [x] 02 - Ticked by hand",
        "- [ ] [03 - Old title](./03-x.md)",
      ),
      "03-x.md": md("---", "title: New title", "---"),
    }),
  )

  effectTest(
    "finishes an interrupted completion",
    Effect.gen(function* () {
      const disk = yield* Disk
      expect(yield* normalizeDisk).toEqual({ assigned: [], finished: ["2"], swept: [] })
      expect(yield* disk.tree()).toEqual(["TODO.md", "done/backend/02-add-rate-limiting.md"])
      expect(yield* disk.read("TODO.md")).toBe(md("## Backend"))
    }),
    diskWith({
      "TODO.md": md(
        "## Backend",
        "",
        "- [ ] [02 - Add rate limiting](./backend/02-add-rate-limiting.md)",
      ),
      "backend/02-add-rate-limiting.md": rateLimiting,
      "done/backend/02-add-rate-limiting.md": rateLimiting,
    }),
  )

  effectTest(
    "changes nothing in a normalized list",
    Effect.gen(function* () {
      const disk = yield* Disk
      expect(yield* normalizeDisk).toEqual({ assigned: [], finished: [], swept: [] })
      expect(yield* disk.read("TODO.md")).toBe(md("# T", "", "- [ ] 01 - A"))
      expect(yield* disk.tree()).toEqual(["TODO.md"])
    }),
    diskWith({ "TODO.md": md("# T", "", "- [ ] 01 - A") }),
  )
})
