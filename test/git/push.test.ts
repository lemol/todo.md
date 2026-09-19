import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { classifyPush, type PushFailure, readGitState } from "../../src/git/index.ts"
import type { ProjectStatus } from "../../src/hub/index.ts"
import { TodoStore } from "../../src/spec/index.ts"
import { effectTest } from "../../src/spec/testing.ts"
import {
  commitAndPush,
  defaultBranch,
  GitFixture,
  git,
  gitList,
  inBun,
  md,
  subjects,
  writeIn,
} from "./helpers.ts"

const todo = md("# Acme API", "", "- [ ] 01 - Write changelog")

const list = () => gitList({ files: { "TODO.md": todo } })

const counts = (clone: string) =>
  git(clone, "rev-list", "--left-right", "--count", "HEAD...@{u}").trim().split(/\s+/)

describe("classifyPush", () => {
  const cases: ReadonlyArray<readonly [PushFailure, string]> = [
    ["rejected", "! [rejected]        main -> main (fetch first)"],
    ["rejected", "Updates were rejected because the tip is behind (non-fast-forward)"],
    ["auth", "git@github.com: Permission denied (publickey)."],
    ["auth", "remote: Authentication failed for 'https://example.com/repo.git'"],
    [
      "auth",
      "fatal: unable to access 'https://example.com/r.git/': The requested URL returned 403",
    ],
    ["offline", "ssh: Could not resolve host: github.com"],
    ["offline", "fatal: Could not read from remote repository."],
    ["remote", "remote: pre-receive hook declined"],
  ]
  for (const [expected, stderr] of cases) {
    test(`reads "${stderr.slice(0, 40)}…" as ${expected}`, () => {
      expect(classifyPush(stderr)).toBe(expected)
    })
  }
})

describe("pushing", () => {
  effectTest(
    "rebases and retries when someone else pushed first",
    Effect.gen(function* () {
      const store = yield* TodoStore
      const { clone, remote, other } = yield* GitFixture
      const theirs = other()
      writeIn(theirs, { "NOTES.md": md("Theirs.") })
      commitAndPush(theirs, "their change")

      yield* store.add({ title: "Ours" })

      expect(counts(clone)).toEqual(["0", "0"])
      expect(subjects(remote, defaultBranch).slice(0, 2)).toEqual([
        expect.stringContaining("todo: add"),
        "their change",
      ])
    }),
    list(),
  )

  effectTest(
    "records a conflicting rebase as diverged, keeps the result and leaves the clone clean",
    Effect.gen(function* () {
      const store = yield* TodoStore
      const { clone, dir, other } = yield* GitFixture
      const theirs = other()
      writeIn(theirs, { "TODO.md": md("# Acme API", "", "- [ ] 01 - Write the release notes") })
      commitAndPush(theirs, "their edit")

      const task = yield* store.update("1", { title: "Write the changelog" })
      expect(task.title).toBe("Write the changelog")

      const state = yield* inBun(readGitState(dir))
      expect(state.diverged).toBe(true)
      expect(state.lastPushError).toContain(clone)
      // No rebase is left in progress, and our commit is still here.
      expect(git(clone, "status", "--porcelain")).toBe("")
      expect(subjects(clone)[0]).toBe("todo: edit 1 - Write the changelog")
    }),
    list(),
  )

  effectTest(
    "keeps the commit and records the reason when the remote is unreachable",
    Effect.gen(function* () {
      const store = yield* TodoStore
      const { clone, dir, remote } = yield* GitFixture
      git(clone, "remote", "set-url", "origin", `${remote}-gone`)

      yield* store.add({ title: "Offline" })

      const [ahead] = counts(clone)
      expect(ahead).toBe("1")
      const state = yield* inBun(readGitState(dir))
      expect(state.lastPushError).toBeDefined()
      expect(state.diverged).toBeUndefined()

      const fixture = yield* GitFixture
      const status = yield* inBun(
        fixture.source.status?.(fixture.project) ?? Effect.succeed<Partial<ProjectStatus>>({}),
      )
      expect(status.ahead).toBe(1)
      expect(status.error).toBe(state.lastPushError)
    }),
    list(),
  )

  effectTest(
    "pushes what is waiting, and forgets the failure, on the next sync",
    Effect.gen(function* () {
      const store = yield* TodoStore
      const fixture = yield* GitFixture
      const { clone, dir, remote } = fixture
      git(clone, "remote", "set-url", "origin", `${remote}-gone`)
      yield* store.add({ title: "Offline" })
      git(clone, "remote", "set-url", "origin", remote)

      const outcome = yield* inBun(
        Effect.orDie(fixture.source.sync?.(fixture.project) ?? Effect.succeed({ summary: "" })),
      )
      expect(outcome.summary).toBe("pushed 1")
      expect(counts(clone)).toEqual(["0", "0"])
      expect(yield* inBun(readGitState(dir))).toEqual({})
    }),
    list(),
  )
})
