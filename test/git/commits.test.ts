import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { TodoStore } from "../../src/spec/index.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { defaultBranch, GitFixture, gitList, md, subjects } from "./helpers.ts"

const todo = md(
  "# Acme API",
  "",
  "- [ ] 01 - Write changelog",
  "",
  "## Backend",
  "",
  "- [ ] 02 - Add rate limiting",
)

const list = () => gitList({ files: { "todo/TODO.md": todo } })

/** The commits the source made, newest first: everything above the seed. */
const made = (repo: string, ref = "HEAD") => subjects(repo, ref).slice(0, -1)

describe("every mutation is one commit", () => {
  effectTest(
    "names the operation, the task and, for a group, both names",
    Effect.gen(function* () {
      const store = yield* TodoStore
      const { clone } = yield* GitFixture
      const added = yield* store.add({ title: "Ship it" })
      yield* store.update("1", { title: "Write the changelog" })
      yield* store.move("1", { group: "Backend" })
      yield* store.comment("2", { author: "lemol", body: "Started." })
      yield* store.renameGroup("Backend", "Server")
      yield* store.complete("2")
      yield* store.reopen("2")
      yield* store.cancel("1", "not needed")
      yield* store.remove(added.id)
      expect(made(clone)).toEqual([
        `todo: remove ${added.id}`,
        "todo: cancel 1 - Write the changelog",
        "todo: reopen 2 - Add rate limiting",
        "todo: complete 2 - Add rate limiting",
        "todo: rename group Backend to Server",
        "todo: comment on 2 - Add rate limiting",
        "todo: move 1 - Write the changelog",
        "todo: edit 1 - Write the changelog",
        `todo: add ${added.id} - Ship it`,
      ])
    }),
    list(),
    15000,
  )

  effectTest(
    "pushes each commit to the remote",
    Effect.gen(function* () {
      const store = yield* TodoStore
      const { clone, remote } = yield* GitFixture
      yield* store.add({ title: "Ship it" })
      yield* store.complete("1")
      expect(made(remote, defaultBranch)).toEqual(made(clone))
    }),
    list(),
  )

  effectTest(
    "leaves a read alone",
    Effect.gen(function* () {
      const store = yield* TodoStore
      const { clone } = yield* GitFixture
      yield* store.load()
      yield* store.get("1")
      yield* store.listDone()
      expect(made(clone)).toEqual([])
    }),
    list(),
  )
})
