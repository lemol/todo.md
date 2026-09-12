import { expect } from "bun:test"
import { Effect } from "effect"
import { TodoStore } from "../../src/spec/index.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, listWith, md } from "./helpers.ts"

effectTest(
  "tasks_dir and done_dir from TODO.md decide where files go",
  Effect.gen(function* () {
    const store = yield* TodoStore
    const disk = yield* Disk
    const task = yield* store.add(
      { title: "Review auth", tags: ["needs review"] },
      { group: "Backend" },
    )
    expect(yield* disk.exists("tasks/backend/01-review-auth.md")).toBe(true)
    yield* store.complete(task.id)
    expect(yield* disk.tree()).toEqual(["TODO.md", "archive/backend/01-review-auth.md"])
    expect((yield* store.get(task.id)).status).toBe("done")
  }),
  listWith({ "TODO.md": md("---", "tasks_dir: tasks", "done_dir: archive", "---", "# T") }),
)
