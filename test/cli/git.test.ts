import { describe, expect } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { gitSourceWith, makeGit } from "../../src/git/index.ts"
import { type AnySource, fsSource } from "../../src/hub/index.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, diskWith } from "../fs/helpers.ts"
import { defaultBranch, md, remoteIn, subjects } from "../git/helpers.ts"
import { runTodo } from "./harness.ts"

const sources: Effect.Effect<ReadonlyArray<AnySource>> = Effect.map(
  Effect.provide(makeGit({ env: {} }), BunServices.layer),
  (git) => [fsSource, gitSourceWith(git)],
)

describe("git projects from the CLI", () => {
  effectTest(
    "clones on add, then commits and pushes every change",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const remote = remoteIn(root, { "todo/TODO.md": md("# Remote", "", "- [ ] 01 - Seeded") })
      const home = `${root}/hub`
      const run = (...args: string[]) =>
        Effect.flatMap(sources, (loaded) => runTodo(args, { home, sources: loaded }))

      const added = yield* run("projects", "add", remote, "--source", "git", "--name", "acme")
      expect(added.stderr).toBe("")
      expect(added.code).toBe(0)
      expect(added.stdout).toContain("acme")

      const listed = yield* run("--project", "acme", "ls")
      expect(listed.code).toBe(0)
      expect(listed.stdout).toContain("Seeded")

      const done = yield* run("--project", "acme", "add", "Ship", "it", "--quick")
      expect(done.stderr).toBe("")
      expect(done.code).toBe(0)

      // The remote has the commit, so nothing stayed local.
      expect(subjects(remote, defaultBranch)[0]).toContain("todo: add")
      expect(subjects(remote, defaultBranch)[0]).toContain("Ship it")
    }),
    diskWith({}),
  )

  effectTest(
    "refuses a repository with no list, and registers nothing",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const remote = remoteIn(root, { "README.md": md("Nothing to do.") })
      const home = `${root}/hub`
      const run = (...args: string[]) =>
        Effect.flatMap(sources, (loaded) => runTodo(args, { home, sources: loaded }))

      const refused = yield* run("projects", "add", remote, "--source", "git", "--name", "empty")
      expect(refused.code).not.toBe(0)
      expect(refused.stderr).toContain("no TODO.md")
      expect((yield* run("projects")).stdout).toContain("No projects registered")
    }),
    diskWith({}),
  )

  effectTest(
    "refuses --branch and --list for a project that is not git",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const run = (...args: string[]) =>
        Effect.flatMap(sources, (loaded) => runTodo(args, { home: `${root}/hub`, sources: loaded }))
      const refused = yield* run("projects", "add", `${root}/local`, "--branch", "main")
      expect(refused.code).toBe(2)
      expect(refused.stderr).toContain("--branch is not for fs projects")

      const both = yield* run("projects", "add", `${root}/local`, "--branch", "main", "--list", "x")
      expect(both.code).toBe(2)
      expect(both.stderr).toContain("--branch and --list are not for fs projects")
    }),
    diskWith({ "local/TODO.md": md("# Local") }),
  )
})
