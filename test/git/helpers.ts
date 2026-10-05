/**
 * Fixtures for the git source: a bare repository as the remote, a hub home,
 * and the source opened over a clone of it.
 *
 * Everything lives in a temporary directory removed with the test's scope, and
 * the identity comes from this process's environment, so the machine's git
 * config decides nothing here and nothing here writes to it.
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { BunServices } from "@effect/platform-bun"
import { Context, Effect, Layer, type Scope } from "effect"
import { type GitConfig, gitSourceWith, makeGit } from "../../src/git/index.ts"
import type { Source, SourceProject } from "../../src/hub/index.ts"
import type { TodoStore } from "../../src/spec/index.ts"

export const md = (...lines: string[]) => `${lines.join("\n")}\n`

/**
 * An identity and no commit signing, for this test process only: the code
 * under test spawns git itself, so the settings have to reach it, and every
 * other way of doing that either writes to the machine's git config or costs
 * three more processes per repository. Nothing outside this process sees them.
 */
Object.assign(process.env, {
  GIT_AUTHOR_NAME: "todo.md tests",
  GIT_AUTHOR_EMAIL: "tests@todo.md",
  GIT_COMMITTER_NAME: "todo.md tests",
  GIT_COMMITTER_EMAIL: "tests@todo.md",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "commit.gpgsign",
  GIT_CONFIG_VALUE_0: "false",
  GIT_TERMINAL_PROMPT: "0",
})

/** Runs git in `cwd`, throwing with its output so a broken fixture says why. */
export const git = (cwd: string, ...args: string[]): string => {
  const result = Bun.spawnSync(["git", ...args], { cwd, env: process.env })

  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} in ${cwd} failed: ${result.stderr.toString()}`)
  }

  return result.stdout.toString()
}

export const writeIn = (repo: string, files: Readonly<Record<string, string>>): void => {
  for (const [relative, text] of Object.entries(files)) {
    const file = join(repo, relative)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text)
  }
}

/** Commits everything in `repo` and pushes it to `origin`. */
export const commitAndPush = (repo: string, message: string): void => {
  git(repo, "add", "-A")
  git(repo, "commit", "-m", message)
  git(repo, "push", "origin", "HEAD")
}

/** Commit subjects, newest first. */
export const subjects = (repo: string, ref = "HEAD"): ReadonlyArray<string> =>
  git(repo, "log", "--pretty=format:%s", ref)
    .split("\n")
    .filter((line) => line !== "")

export const defaultBranch = "main"
/** A second branch every template carries, so `branch` in the config has something to follow. */
export const otherBranch = "release"

export interface FixtureOptions {
  /** The list as it starts out in the remote. */
  readonly files?: Readonly<Record<string, string>>
  /** The project's config beyond `url`. */
  readonly branch?: string
  readonly list?: string
  readonly name?: string
  /** Clone it up front, as `add` would (default: yes). */
  readonly prepared?: boolean
}

export class GitFixture extends Context.Service<
  GitFixture,
  {
    readonly root: string
    /** The bare repository standing in for a remote. */
    readonly remote: string
    /** The project's data directory, `<home>/projects/<name>`. */
    readonly dir: string
    readonly clone: string
    readonly source: Source<GitConfig>
    readonly project: SourceProject<GitConfig>
    /** A separate clone of the remote, for a change made by someone else. */
    other(name?: string): string
  }
>()("test/git/GitFixture") {}

/**
 * Seeded bare repositories, built once per set of files and copied for each
 * case: the conformance suite alone asks for fifty of them, and building each
 * one from scratch costs five processes.
 */
const templates = new Map<string, string>()
let templateHome: string | undefined

const templateFor = (files: Readonly<Record<string, string>>): string => {
  const key = JSON.stringify(files)
  const found = templates.get(key)

  if (found !== undefined) return found

  if (templateHome === undefined) {
    templateHome = mkdtempSync(join(tmpdir(), "todo-md-git-templates-"))
    const home = templateHome
    process.on("exit", () => rmSync(home, { recursive: true, force: true }))
  }

  const remote = join(templateHome, `remote-${templates.size}.git`)
  git(templateHome, "init", "--bare", `--initial-branch=${defaultBranch}`, remote)
  const seed = join(templateHome, `seed-${templates.size}`)
  git(templateHome, "clone", remote, seed)
  writeIn(seed, files)
  commitAndPush(seed, "seed")
  git(seed, "checkout", "-b", otherBranch)
  writeIn(seed, { "RELEASE.md": "Released.\n" })
  commitAndPush(seed, "release notes")
  rmSync(seed, { recursive: true, force: true })
  templates.set(key, remote)

  return remote
}

/** A bare repository under `root`, seeded with `files` on `main` (and `release`). */
export const remoteIn = (
  root: string,
  files: Readonly<Record<string, string>>,
  name = "remote.git",
): string => {
  const remote = join(root, name)
  cpSync(templateFor(files), remote, { recursive: true })

  return remote
}

const seededRemote = (root: string, files: Readonly<Record<string, string>>): string =>
  remoteIn(root, files)

/**
 * A prepared git project: the remote, the clone the source made, and the
 * source itself.
 */
export const fixture = (options: FixtureOptions = {}): Layer.Layer<GitFixture, never, never> =>
  Layer.effect(
    GitFixture,
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.sync(() => mkdtempSync(join(tmpdir(), "todo-md-git-"))),
        (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
      )

      const remote = seededRemote(root, options.files ?? { "TODO.md": md("# Conformance") })
      const name = options.name ?? "repo"
      const dir = join(root, "home", "projects", name)
      mkdirSync(dir, { recursive: true })
      const source = gitSourceWith(yield* makeGit({ env: {} }))
      const config: GitConfig = {
        url: remote,
        ...(options.branch === undefined ? {} : { branch: options.branch }),
        ...(options.list === undefined ? {} : { list: options.list }),
      }

      const project: SourceProject<GitConfig> = { name, config, dir }

      if (options.prepared !== false) yield* Effect.orDie(source.prepare?.(project) ?? Effect.void)

      const clone = join(dir, "clone")

      return GitFixture.of({
        root,
        remote,
        dir,
        clone,
        source,
        project,
        other: (label = "other") => {
          const path = join(root, label)
          git(root, "clone", remote, path)

          return path
        },
      })
    }),
  ).pipe(Layer.provide(BunServices.layer)) as Layer.Layer<GitFixture, never, never>

/** The fixture's store, for the conformance suite and for mutation tests. */
export const gitList = (
  options: FixtureOptions = {},
): Layer.Layer<TodoStore | GitFixture, unknown> =>
  Layer.unwrap(Effect.map(GitFixture, (found) => found.source.open(found.project))).pipe(
    Layer.provideMerge(fixture(options)),
    Layer.provide(BunServices.layer),
  )

/** Runs an effect that needs the platform services the source and fixture use. */
export const inBun = <A, E>(
  effect: Effect.Effect<A, E, BunServices.BunServices | Scope.Scope>,
): Effect.Effect<A, E, Scope.Scope> => Effect.provide(effect, BunServices.layer)
