/**
 * Pushing, and the little state file that outlives the process.
 *
 * A mutation never fails because of the network (hub design §4, git): when a
 * push cannot land, the commit stays local and the reason is written to
 * `<dir>/git.json`, which `status` reports. `state.json` next to it belongs to
 * the hub.
 */

import { Effect, FileSystem, Path, Random, Result, Schema } from "effect"
import type { Lock } from "../fs/index.ts"
import type { SourceEnv } from "../hub/index.ts"
import type { Git, GitError } from "./git.ts"

export const gitStateFile = "git.json"

/** What the source remembers between runs: why the last push did not land. */
export const GitState = Schema.Struct({
  version: Schema.Literal(1),
  lastPushError: Schema.optional(Schema.String),
  diverged: Schema.optional(Schema.Boolean),
})
export type GitState = typeof GitState.Type

const StateJson = Schema.fromJsonString(GitState)

const empty: Omit<GitState, "version"> = {}

/** `<dir>/git.json`; an absent or unreadable file reads as nothing recorded. */
export const readGitState = (
  dir: string,
): Effect.Effect<Omit<GitState, "version">, never, SourceEnv> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const file = (yield* Path.Path).join(dir, gitStateFile)
    return yield* fs.readFileString(file).pipe(
      Effect.flatMap((text) => Schema.decodeUnknownEffect(StateJson)(text)),
      Effect.map(({ version: _version, ...state }) => state),
      Effect.orElseSucceed(() => empty),
    )
  })

/** Replaces `<dir>/git.json` atomically. Failures are the caller's to ignore. */
export const writeGitState = (dir: string, state: Omit<GitState, "version">) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const file = (yield* Path.Path).join(dir, gitStateFile)
    const encoded = yield* Schema.encodeEffect(GitState)({ version: 1, ...state })
    const token = yield* Random.nextIntBetween(0, Number.MAX_SAFE_INTEGER)
    const temporary = `${file}.${token.toString(36)}.tmp`
    yield* fs.makeDirectory(dir, { recursive: true })
    yield* fs.writeFileString(temporary, `${JSON.stringify(encoded, null, 2)}\n`).pipe(
      Effect.andThen(fs.rename(temporary, file)),
      Effect.onError(() => Effect.ignore(fs.remove(temporary))),
    )
  })

/** Forgets a recorded failure, after a push or a sync lands. */
export const clearGitState = (dir: string): Effect.Effect<void, never, SourceEnv> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const file = (yield* Path.Path).join(dir, gitStateFile)
    yield* Effect.ignore(fs.remove(file))
  })

/** Why a push did not land. `rejected` is the one worth rebasing and retrying. */
export type PushFailure = "rejected" | "offline" | "auth" | "remote"

const patterns: ReadonlyArray<readonly [PushFailure, ReadonlyArray<string>]> = [
  ["rejected", ["[rejected]", "non-fast-forward", "fetch first"]],
  ["auth", ["permission denied", "authentication failed", "403", "access denied"]],
  [
    "offline",
    [
      "could not resolve host",
      "connection refused",
      "unable to access",
      "connection timed out",
      "operation timed out",
      "network is unreachable",
      "could not read from remote repository",
    ],
  ],
]

/**
 * Classifies git's stderr. Auth is matched before the network so that
 * "unable to access … 403" reads as a credential problem, not an outage.
 */
export const classifyPush = (stderr: string): PushFailure => {
  const text = stderr.toLowerCase()
  for (const [failure, needles] of patterns) {
    if (needles.some((needle) => text.includes(needle))) return failure
  }
  return "remote"
}

/** The upstream a push targets: the configured branch, else the checked-out one. */
export const branchOf = (
  git: Git,
  clone: string,
  configured: string | undefined,
): Effect.Effect<string, GitError> =>
  configured !== undefined
    ? Effect.succeed(configured)
    : Effect.map(git(clone, ["rev-parse", "--abbrev-ref", "HEAD"]), (out) => out.trim())

/** Local commits not pushed and remote commits not pulled; zeros without an upstream. */
export const countsOf = (
  git: Git,
  clone: string,
): Effect.Effect<{ readonly ahead: number; readonly behind: number }> =>
  git(clone, ["rev-list", "--left-right", "--count", "HEAD...@{u}"]).pipe(
    Effect.map((out) => {
      const [ahead, behind] = out.trim().split(/\s+/)
      return { ahead: Number(ahead) || 0, behind: Number(behind) || 0 }
    }),
    Effect.orElseSucceed(() => ({ ahead: 0, behind: 0 })),
  )

/** What a push attempt did, for `sync` to turn into a `SyncError` and for a mutation to record. */
export type PushOutcome =
  | { readonly _tag: "Pushed" }
  | { readonly _tag: "UpToDate" }
  | { readonly _tag: "Diverged"; readonly message: string }
  | { readonly _tag: "Failed"; readonly reason: PushFailure; readonly message: string }

export interface PushContext {
  readonly git: Git
  readonly clone: string
  /** The branch from the config, or `undefined` to use the checked-out one. */
  readonly branch: string | undefined
  /** The clone lock: held while `pull --rebase` rewrites the working tree. */
  readonly lock: Lock
}

/**
 * Pushes the local commits. A rejected push is rebased onto the remote and
 * retried once; a conflicting rebase is aborted, so the clone is never left
 * mid-rebase for the next command to trip over.
 */
export const pushCommits = (context: PushContext): Effect.Effect<PushOutcome> =>
  Effect.gen(function* () {
    const { git, clone, lock } = context
    const { ahead } = yield* countsOf(git, clone)
    if (ahead === 0) return { _tag: "UpToDate" } as const
    const branch = yield* Effect.result(branchOf(git, clone, context.branch))
    if (Result.isFailure(branch)) {
      return { _tag: "Failed", reason: "remote", message: branch.failure.message } as const
    }
    const push = git(clone, ["push", "origin", `HEAD:${branch.success}`])

    const first = yield* Effect.result(push)
    if (Result.isSuccess(first)) return { _tag: "Pushed" } as const
    const failure = classifyPush(first.failure.stderr)
    if (failure !== "rejected") {
      return { _tag: "Failed", reason: failure, message: first.failure.message } as const
    }

    // Someone else pushed first: replay our commits on top and try once more.
    const rebased = yield* Effect.result(lock(git(clone, ["pull", "--rebase"])))
    if (Result.isFailure(rebased)) {
      yield* Effect.ignore(lock(git(clone, ["rebase", "--abort"])))
      return {
        _tag: "Diverged",
        message: `${rebased.failure.message}; resolve it in ${clone}`,
      } as const
    }
    const second = yield* Effect.result(push)
    if (Result.isSuccess(second)) return { _tag: "Pushed" } as const
    return {
      _tag: "Failed",
      reason: classifyPush(second.failure.stderr),
      message: second.failure.message,
    } as const
  })

/** Records a push outcome in `<dir>/git.json`; a successful push clears it. */
export const recordPush = (
  dir: string,
  outcome: PushOutcome,
): Effect.Effect<void, never, SourceEnv> =>
  Effect.ignore(
    outcome._tag === "Pushed" || outcome._tag === "UpToDate"
      ? clearGitState(dir)
      : outcome._tag === "Diverged"
        ? writeGitState(dir, { lastPushError: outcome.message, diverged: true })
        : writeGitState(dir, { lastPushError: outcome.message }),
  )
