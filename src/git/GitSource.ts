/**
 * The git source: a list in a git repository, cloned into the hub's own
 * directory. See [the hub design](../../docs/superpowers/specs/2026-09-13-hub-design.md#git-srcgit-lemoltodo-mdgit).
 */

import {
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  type PlatformError,
  Result,
  Schema,
  Stream,
} from "effect"
import type { ChildProcessSpawner } from "effect/process"
import { FsTodoStore, makeLock } from "../fs/index.ts"
import {
  nameFrom,
  type ProjectStatus,
  type Source,
  type SourceEnv,
  SourceError,
  type SourceProject,
  SyncError,
  type SyncOutcome,
  watchList,
} from "../hub/index.ts"
import { TodoStore } from "../spec/index.ts"
import { type Git, type GitOptions, makeGit } from "./git.ts"
import {
  classifyPush,
  clearGitState,
  countsOf,
  pushCommits,
  readGitState,
  recordPush,
} from "./push.ts"
import { committing } from "./store.ts"

const insideRepository = Schema.makeFilter(
  (path: string) =>
    (!path.startsWith("/") && !path.split("/").includes("..")) ||
    "must be a path inside the repository",
)

/** `{ url, branch?, list? }`: where the repository is, and where the list sits inside it. */
export const GitConfig = Schema.Struct({
  url: Schema.String.check(
    Schema.makeFilter((url: string) => url.trim() !== "" || "must not be empty"),
  ),
  branch: Schema.optional(Schema.String),
  list: Schema.optional(Schema.String.check(insideRepository)),
})
export type GitConfig = typeof GitConfig.Type

/** The repository's own name, without `.git`: `git@host:owner/repo.git` → `repo`. */
export const repoNameOf = (url: string): string | undefined => {
  const trimmed = url
    .trim()
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")

  const start = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf(":")) + 1

  return nameFrom(trimmed.slice(start))
}

/** The list inside the clone: `list` when configured, else `todo/` then the repository root. */
const listRootIn = (
  clone: string,
  list: string | undefined,
): Effect.Effect<Option.Option<string>, PlatformError.PlatformError, SourceEnv> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const candidates =
      list === undefined ? [path.join(clone, "todo"), clone] : [path.resolve(clone, list)]

    for (const root of candidates) {
      if (yield* fs.exists(path.join(root, "TODO.md"))) return Option.some(root)
    }

    return Option.none<string>()
  })

const whereTheListWouldBe = (list: string | undefined) =>
  list === undefined ? "todo/ or the repository root" : list

const cloneArgs = (config: GitConfig, into: string): ReadonlyArray<string> => [
  "clone",
  "--filter=blob:none",
  ...(config.branch === undefined ? [] : ["--branch", config.branch]),
  config.url,
  into,
]

/** git's stderr as a `SyncError` reason; a rejected fetch or clone is just a remote problem. */
const syncReason = (stderr: string): SyncError["reason"] => {
  const failure = classifyPush(stderr)

  return failure === "rejected" ? "remote" : failure
}

/**
 * A `Source` over `git`. Built from a `Git` rather than taking one from the
 * environment, so the hub never sees a `ChildProcessSpawner` requirement.
 */
export const gitSourceWith = (git: Git): Source<GitConfig> => {
  const sourceError = (name: string, message: string, cause?: unknown) =>
    new SourceError({ name, message, ...(cause === undefined ? {} : { cause }) })

  /** A git project always has a data directory; only unregistered projects lack one. */
  const located = (project: SourceProject<GitConfig>): Effect.Effect<string, SourceError> =>
    project.dir === undefined
      ? Effect.fail(
          sourceError(project.name, "a git project must be registered before it can be opened"),
        )
      : Effect.succeed(project.dir)

  /** The clone directory, and whether it is there. */
  const cloneOf = (project: SourceProject<GitConfig>) =>
    Effect.gen(function* () {
      const dir = yield* located(project)
      const path = yield* Path.Path
      const fs = yield* FileSystem.FileSystem
      const clone = path.join(dir, "clone")
      const cloned = yield* fs.exists(clone).pipe(Effect.orElseSucceed(() => false))

      return { dir, clone, cloned }
    })

  const listRootOf = (project: SourceProject<GitConfig>, clone: string) =>
    listRootIn(clone, project.config.list).pipe(
      Effect.mapError((cause) =>
        sourceError(project.name, `could not look for a list in ${clone}: ${cause.message}`, cause),
      ),
      Effect.flatMap((root) =>
        Option.isSome(root)
          ? Effect.succeed(root.value)
          : Effect.fail(
              sourceError(
                project.name,
                `no TODO.md in ${clone} at ${whereTheListWouldBe(project.config.list)}`,
              ),
            ),
      ),
    )

  return {
    kind: "git",
    config: GitConfig,
    defaultName: (config) => repoNameOf(config.url),
    location: (config) =>
      config.branch === undefined ? config.url : `${config.url}#${config.branch}`,

    prepare: (project) =>
      Effect.gen(function* () {
        const dir = yield* located(project)
        const path = yield* Path.Path
        const clone = path.join(dir, "clone")
        yield* git(dir, cloneArgs(project.config, clone)).pipe(
          Effect.mapError((cause) =>
            sourceError(
              project.name,
              `could not clone ${project.config.url}: ${cause.stderr}`,
              cause,
            ),
          ),
        )
        yield* listRootOf(project, clone)
      }),

    open: (project) =>
      Layer.unwrap(
        Effect.gen(function* () {
          const { dir, clone, cloned } = yield* cloneOf(project)

          if (!cloned) {
            return yield* Effect.fail(
              sourceError(
                project.name,
                `${project.name} is not cloned; run \`todo sync ${project.name}\``,
              ),
            )
          }

          const path = yield* Path.Path
          const root = yield* listRootOf(project, clone)
          const relative = path.relative(clone, root)
          const lock = yield* makeLock(dir)

          return Layer.effect(
            TodoStore,
            Effect.flatMap(TodoStore, (store) =>
              committing(store, {
                git,
                clone,
                dir,
                listPath: relative === "" ? "." : relative,
                branch: project.config.branch,
                lock,
              }),
            ),
          ).pipe(
            Layer.provide(
              FsTodoStore.layer({
                root,
                ...(project.cacheDir === undefined ? {} : { cacheDir: project.cacheDir }),
              }),
            ),
          )
        }),
      ),

    sync: (project) =>
      Effect.gen(function* () {
        const name = project.name

        const fail = (reason: SyncError["reason"], message: string) =>
          new SyncError({ project: name, reason, message })

        const { dir, clone, cloned } = yield* cloneOf(project).pipe(
          Effect.mapError((error) => fail("remote", error.message)),
        )

        if (!cloned) {
          yield* git(dir, cloneArgs(project.config, clone)).pipe(
            Effect.mapError((cause) =>
              fail(
                syncReason(cause.stderr),
                `could not clone ${project.config.url}: ${cause.stderr}`,
              ),
            ),
          )
          yield* clearGitState(dir)

          return { summary: "cloned", ahead: 0, behind: 0 } satisfies SyncOutcome
        }

        const lock = yield* makeLock(dir)
        // Fetching and rebasing rewrite the working tree, so they hold the
        // clone lock; the push below takes it only if it has to rebase.
        const pulled = yield* lock(
          Effect.gen(function* () {
            const before = (yield* git(clone, ["rev-parse", "HEAD"])).trim()
            yield* git(clone, ["fetch", "origin"])
            const rebased = yield* Effect.result(git(clone, ["pull", "--rebase"]))

            if (Result.isFailure(rebased)) {
              yield* Effect.ignore(git(clone, ["rebase", "--abort"]))

              return yield* fail("diverged", `${rebased.failure.message}; resolve it in ${clone}`)
            }

            const count = yield* git(clone, ["rev-list", "--count", `${before}..HEAD`])

            return Number(count.trim()) || 0
          }),
        ).pipe(
          Effect.catch((error) =>
            error._tag === "SyncError"
              ? error
              : error._tag === "StoreError"
                ? fail("remote", error.message)
                : fail(syncReason(error.stderr), error.message),
          ),
        )

        const { ahead } = yield* countsOf(git, clone)

        if (ahead > 0) {
          const outcome = yield* pushCommits({ git, clone, branch: project.config.branch, lock })
          yield* recordPush(dir, outcome)

          if (outcome._tag === "Diverged") return yield* fail("diverged", outcome.message)

          if (outcome._tag === "Failed") return yield* fail(outcome.reason, outcome.message)
        }

        yield* clearGitState(dir)
        const parts = [
          ...(pulled > 0 ? [`pulled ${pulled} commit${pulled === 1 ? "" : "s"}`] : []),
          ...(ahead > 0 ? [`pushed ${ahead}`] : []),
        ]

        return {
          summary: parts.length === 0 ? "up to date" : parts.join(", "),
          ...(yield* countsOf(git, clone)),
        } satisfies SyncOutcome
      }),

    status: (project) =>
      Effect.gen(function* () {
        const found = yield* Effect.result(cloneOf(project))

        if (Result.isFailure(found) || !found.success.cloned) return {}

        const { dir, clone } = found.success
        const state = yield* readGitState(dir)

        return {
          ...(yield* countsOf(git, clone)),
          ...(state.diverged === true ? { diverged: true } : {}),
          ...(state.lastPushError === undefined
            ? {}
            : { result: "error" as const, error: state.lastPushError }),
        } satisfies Partial<ProjectStatus>
      }),

    changes: (project) => {
      const stop = (reason: string): Stream.Stream<void, never, SourceEnv> =>
        Stream.drain(
          Stream.fromEffect(Effect.logWarning(`stopped watching ${project.name}: ${reason}`)),
        )

      return Stream.unwrap(
        Effect.gen(function* () {
          const { clone, cloned } = yield* cloneOf(project)

          if (!cloned) return stop(`${project.name} is not cloned`)

          const root = yield* listRootOf(project, clone)
          // When the list is the repository root, `.git` is inside the watched
          // tree: every commit we make would otherwise look like a change.
          const watching: Stream.Stream<void, PlatformError.PlatformError, SourceEnv> = watchList(
            root,
            { ignore: (path) => path.split(/[\\/]/).includes(".git") },
          )

          return watching
        }),
      ).pipe(Stream.catch((error) => stop(error.message)))
    },

    beforeRemove: (project, force) =>
      Effect.gen(function* () {
        if (force) return

        const found = yield* Effect.result(cloneOf(project))

        if (Result.isFailure(found) || !found.success.cloned) return

        const { ahead } = yield* countsOf(git, found.success.clone)

        if (ahead > 0) {
          return yield* sourceError(
            project.name,
            `${project.name} has ${ahead} unpushed commit${ahead === 1 ? "" : "s"} in ${found.success.clone}; use --force`,
          )
        }
      }),
  }
}

/**
 * Builds the git source. Run it at the composition root, where a
 * `ChildProcessSpawner` is available.
 */
export const make = (
  options: GitOptions = {},
): Effect.Effect<Source<GitConfig>, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.map(makeGit(options), gitSourceWith)
