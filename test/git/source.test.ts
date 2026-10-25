import { describe, expect, test } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { repoNameOf } from "../../src/git/index.ts"
import { TodoStore } from "../../src/spec/index.ts"
import { effectTest } from "../../src/spec/testing.ts"
import {
  commitAndPush,
  defaultBranch,
  fixture,
  GitFixture,
  git,
  gitList,
  inBun,
  md,
  otherBranch,
  subjects,
  writeIn,
} from "./helpers.ts"

const todo = md("# Acme API", "", "- [ ] 01 - Write changelog")

/** `sync`, `status` and `beforeRemove` as the hub calls them. */
const syncing = Effect.fn(function* () {
  const { source, project } = yield* GitFixture

  return yield* inBun(Effect.orDie(source.sync?.(project) ?? Effect.die("no sync")))
})

const statusing = Effect.fn(function* () {
  const { source, project } = yield* GitFixture

  return yield* inBun(source.status?.(project) ?? Effect.succeed({}))
})

const removing = (force: boolean) =>
  Effect.gen(function* () {
    const { source, project } = yield* GitFixture

    return yield* inBun(Effect.result(source.beforeRemove?.(project, force) ?? Effect.void))
  })

describe("the git source", () => {
  test("names a project after the repository", () => {
    expect(repoNameOf("git@github.com:acme/app.git")).toBe("app")
    expect(repoNameOf("https://github.com/lemol/Todo.md.git")).toBe("todo-md")
    expect(repoNameOf("https://github.com/acme/app")).toBe("app")
    expect(repoNameOf("/srv/repos/acme.git/")).toBe("acme")
    expect(repoNameOf("")).toBeUndefined()
  })

  effectTest(
    "finds the list at todo/ first, then at the repository root",
    Effect.gen(function* () {
      expect((yield* TodoStore).capabilities.add).toBe(true)
      expect((yield* store()).title).toBe("Inner")
    }),
    gitList({ files: { "TODO.md": md("# Outer"), "todo/TODO.md": md("# Inner") } }),
  )

  effectTest(
    "uses the configured list directory instead",
    Effect.gen(function* () {
      expect((yield* store()).title).toBe("Docs")
    }),
    gitList({
      files: { "todo/TODO.md": md("# Inner"), "docs/todo/TODO.md": md("# Docs") },
      list: "docs/todo",
    }),
  )

  effectTest(
    "refuses to open a project that is not cloned, and clones it on sync",
    Effect.gen(function* () {
      const found = yield* GitFixture
      const opened = yield* inBun(
        Effect.result(Effect.scoped(Layer.build(found.source.open(found.project)))),
      )

      expect(opened._tag).toBe("Failure")

      if (opened._tag === "Failure") {
        expect(opened.failure.message).toContain("todo sync repo")
      }

      expect((yield* syncing()).summary).toBe("cloned")
      expect(git(found.clone, "ls-files")).toContain("TODO.md")
    }),
    fixture({ files: { "TODO.md": todo }, prepared: false }),
  )

  effectTest(
    "pulls what the remote gained, and reports it",
    Effect.gen(function* () {
      const { other, clone } = yield* GitFixture
      const theirs = other()

      writeIn(theirs, { "NOTES.md": md("One.") })
      commitAndPush(theirs, "their first")
      writeIn(theirs, { "NOTES.md": md("Two.") })
      commitAndPush(theirs, "their second")

      const outcome = yield* syncing()

      expect(outcome.summary).toBe("pulled 2 commits")
      expect(outcome).toMatchObject({ ahead: 0, behind: 0 })
      expect(subjects(clone).slice(0, 2)).toEqual(["their second", "their first"])
      expect((yield* syncing()).summary).toBe("up to date")
    }),
    fixture({ files: { "TODO.md": todo } }),
  )

  effectTest(
    "reports what the clone is ahead and behind by",
    Effect.gen(function* () {
      const { other, clone } = yield* GitFixture
      const theirs = other()

      writeIn(theirs, { "NOTES.md": md("Theirs.") })
      commitAndPush(theirs, "their change")
      writeIn(clone, { "MINE.md": md("Mine.") })
      git(clone, "add", "-A")
      git(clone, "commit", "-m", "my change")
      git(clone, "fetch", "origin")

      expect(yield* statusing()).toMatchObject({ ahead: 1, behind: 1 })
    }),
    fixture({ files: { "TODO.md": todo } }),
  )

  effectTest(
    "refuses removal while commits are unpushed, and allows it when forced",
    Effect.gen(function* () {
      const { clone } = yield* GitFixture

      expect((yield* removing(false))._tag).toBe("Success")

      writeIn(clone, { "MINE.md": md("Mine.") })
      git(clone, "add", "-A")
      git(clone, "commit", "-m", "my change")

      const refused = yield* removing(false)

      expect(refused._tag).toBe("Failure")

      if (refused._tag === "Failure") {
        expect(refused.failure.message).toContain("1 unpushed commit")
      }

      expect((yield* removing(true))._tag).toBe("Success")
    }),
    fixture({ files: { "TODO.md": todo } }),
  )

  effectTest(
    "clones, follows and pushes to the configured branch",
    Effect.gen(function* () {
      const store_ = yield* TodoStore
      const { clone, remote, source, project } = yield* GitFixture

      expect(git(clone, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe(otherBranch)
      expect(source.location(project.config)).toBe(`${remote}#${otherBranch}`)

      yield* store_.add({ title: "On release" })
      expect(subjects(remote, otherBranch)[0]).toContain("todo: add")
      expect(subjects(remote, defaultBranch)[0]).toBe("seed")
    }),
    gitList({ files: { "TODO.md": todo }, branch: otherBranch }),
  )

  effectTest(
    "stops watching, without failing, a project that is not cloned",
    Effect.gen(function* () {
      const { source, project } = yield* GitFixture

      expect(yield* inBun(Stream.runCollect(source.changes?.(project) ?? Stream.empty))).toEqual([])
    }),
    fixture({ files: { "TODO.md": todo }, prepared: false }),
  )
})

/** The list as the store sees it. */
const store = () => Effect.flatMap(TodoStore, (found) => found.load())
