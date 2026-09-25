import { DateTime, Effect } from "effect"
import { TestClock } from "effect/testing"
import { TodoStore } from "../../TodoStore.ts"
import { equal, failsWith } from "./assert.ts"
import { type ConformanceCase, given } from "./case.ts"

const at = Date.parse("2026-09-12T12:00:00Z")

export const commentCases: ReadonlyArray<ConformanceCase> = [
  {
    name: "comment adds comments newest first, stamped with the current time",
    requires: ["comments"],
    setup: true,
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      yield* TestClock.setTime(at)
      const [task] = yield* given({ title: "Add rate limiting" })
      const first = yield* store.comment(task.id, {
        author: "lemol",
        body: "Do this after the login fix.",
      })
      yield* TestClock.adjust("1 minute")
      yield* store.comment(task.id, { author: "claude", body: "Started on the token bucket." })
      equal(DateTime.toEpochMillis(first.at), at)
      const { comments } = yield* store.get(task.id)
      equal(
        comments.map((c) => c.body),
        ["Started on the token bucket.", "Do this after the login fix."],
      )
      // Without `commentAuthor` the backend's own user signs every comment.
      if (!store.capabilities.commentAuthor) {
        equal(first.author, comments[1]?.author)
        return
      }
      equal(first.author, "lemol")
      equal(
        comments.map((c) => c.author),
        ["claude", "lemol"],
      )
    }),
  },
  {
    name: "comment works on a done task",
    requires: ["comments"],
    setup: true,
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const [task] = yield* given({ title: "Ship it", done: true })
      yield* store.comment(task.id, { author: "lemol", body: "Shipped in 0.1." })
      equal((yield* store.get(task.id)).comments.length, 1)
    }),
  },
  {
    name: "comment rejects invalid input and unknown tasks, changing nothing",
    requires: ["comments"],
    setup: true,
    run: Effect.gen(function* () {
      const store = yield* TodoStore
      const [task] = yield* given({ title: "Task" })
      yield* failsWith(store.comment(task.id, { author: "le mol", body: "Hi." }), "ValidationError")
      yield* failsWith(store.comment(task.id, { author: "lemol", body: "" }), "ValidationError")
      yield* failsWith(
        store.comment("does-not-exist", { author: "lemol", body: "Hi." }),
        "TaskNotFound",
      )
      equal((yield* store.get(task.id)).comments, [])
    }),
  },
]
