import { describe, expect } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { FsTodoStore } from "../../src/fs/index.ts"
import { TodoStore } from "../../src/spec/index.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, listWith, md } from "./helpers.ts"

const handEdited = md(
  "# T",
  "",
  "* [ ] 01 - Kept as written",
  "- [ ] Buy milk",
  "",
  "A note between tasks.",
  "",
  "- [x] 02 - Ticked by hand",
  "- [ ] [03 - Old title](./03-rename-me.md)",
)

const renameMe = md("---", "title: New title", "---")

const list = () => listWith({ "TODO.md": handEdited, "03-rename-me.md": renameMe })

const ids = Effect.gen(function* () {
  const list = yield* (yield* TodoStore).load()

  return list.ungrouped.map((task) => task.id)
})

describe("FsTodoStore and hand edits", () => {
  effectTest(
    "reads report pending normalization but never write",
    Effect.gen(function* () {
      const store = yield* TodoStore
      const disk = yield* Disk
      expect(yield* ids).toEqual(["1", "3"])
      expect((yield* store.get("2")).status).toBe("done")
      expect((yield* store.listDone()).map((task) => task.id)).toEqual(["2"])
      expect((yield* store.diagnostics()).map((d) => d.code).sort()).toEqual([
        "checked-item",
        "missing-id",
        "stale-link-text",
      ])
      expect(yield* disk.read("TODO.md")).toBe(handEdited)
      expect(yield* disk.tree()).toEqual(["03-rename-me.md", "TODO.md"])
    }),
    list(),
  )

  effectTest(
    "the next change numbers new items, sweeps ticked ones and syncs link text",
    Effect.gen(function* () {
      const disk = yield* Disk
      yield* (yield* TodoStore).add({ title: "Added" })
      expect(yield* disk.read("TODO.md")).toBe(
        md(
          "# T",
          "",
          "* [ ] 01 - Kept as written",
          "- [ ] 04 - Buy milk",
          "",
          "A note between tasks.",
          "",
          "- [ ] [03 - New title](./03-rename-me.md)",
          "- [ ] 05 - Added",
        ),
      )
      expect(yield* disk.exists("done/02-ticked-by-hand.md")).toBe(true)
      expect(yield* (yield* TodoStore).diagnostics()).toEqual([])
    }),
    list(),
  )

  effectTest(
    "normalize reports what it changed",
    Effect.gen(function* () {
      const disk = yield* Disk
      const report = yield* FsTodoStore.normalize(disk.root).pipe(Effect.provide(BunServices.layer))
      expect(report).toEqual({ assigned: ["4"], finished: [], swept: ["2"] })
    }),
    list(),
  )
  effectTest(
    "an interrupted completion reads as done, and the next change finishes it",
    Effect.gen(function* () {
      const store = yield* TodoStore
      const disk = yield* Disk
      expect((yield* store.load()).groups[0]?.tasks).toEqual([])
      expect((yield* store.get("2")).status).toBe("done")
      yield* store.add({ title: "Next" })
      expect(yield* disk.tree()).toEqual(["TODO.md", "done/backend/02-add-rate-limiting.md"])
      expect(yield* disk.read("TODO.md")).toBe(md("- [ ] 03 - Next", "", "## Backend"))
    }),
    listWith({
      "TODO.md": md(
        "## Backend",
        "",
        "- [ ] [02 - Add rate limiting](./backend/02-add-rate-limiting.md)",
      ),
      "backend/02-add-rate-limiting.md": md("---", "title: Add rate limiting", "---"),
      "done/backend/02-add-rate-limiting.md": md("---", "title: Add rate limiting", "---"),
    }),
  )
})
