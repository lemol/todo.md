/**
 * The git store: `FsTodoStore` over the clone, with a commit per mutation and
 * a push after it.
 *
 * Reads go straight through. A mutation holds the clone lock while it writes
 * the files and commits them, so a second process never commits half of
 * someone else's change, and pushes once the lock is free.
 */

import { Effect, Result } from "effect"
import type { Lock } from "../fs/index.ts"
import type { SourceEnv } from "../hub/index.ts"
import { StoreError, type Task, type TaskId, TodoStore } from "../spec/index.ts"
import type { Git } from "./git.ts"
import { pushCommits, recordPush } from "./push.ts"

export interface StoreContext {
  readonly git: Git
  /** The working clone, `<dir>/clone`. */
  readonly clone: string
  /** The list directory relative to the clone; `.` when the list is the clone root. */
  readonly listPath: string
  /** The project's data directory, where `git.json` lives. */
  readonly dir: string
  /** The branch to push to, or `undefined` for the checked-out one. */
  readonly branch: string | undefined
  /** The clone lock, `<dir>/.todo.lock`. */
  readonly lock: Lock
}

/** `git diff --cached --quiet` exits 1 when something is staged; anything else is a real failure. */
const nothingStagedExitCode = 1

/**
 * Wraps `store` so every mutation becomes a commit and a push attempt.
 *
 * A commit that fails (no git identity, a hook that refuses) is a
 * `StoreError`: the files are already written, so the change is not lost, and
 * the next mutation's `git add -A` picks it up. A push that fails is not an
 * error at all — it is recorded and reported by `status`.
 */
export const committing = (
  store: TodoStore["Service"],
  context: StoreContext,
): Effect.Effect<TodoStore["Service"], never, SourceEnv> =>
  Effect.gen(function* () {
    const env = yield* Effect.context<SourceEnv>()
    const { git, clone, listPath, dir, lock } = context

    const commit = (message: string) =>
      Effect.gen(function* () {
        yield* git(clone, ["add", "-A", "--", listPath])
        const staged = yield* Effect.result(git(clone, ["diff", "--cached", "--quiet"]))
        if (Result.isSuccess(staged)) return
        if (staged.failure.code !== nothingStagedExitCode) return yield* staged.failure
        yield* git(clone, ["commit", "-m", message])
      }).pipe(
        Effect.mapError(
          (cause) =>
            new StoreError({ message: `could not record the change: ${cause.message}`, cause }),
        ),
      )

    const push = pushCommits(context).pipe(
      Effect.flatMap((outcome) => recordPush(dir, outcome)),
      Effect.provideContext(env),
    )

    const mutate = <A, E>(
      run: Effect.Effect<A, E>,
      message: (value: A) => Effect.Effect<string>,
    ): Effect.Effect<A, E | StoreError> =>
      lock(Effect.tap(run, (value) => Effect.flatMap(message(value), commit))).pipe(
        Effect.tap(() => push),
      )

    const verb = (name: string) => (task: Task) =>
      Effect.succeed(`todo: ${name} ${task.id} - ${task.title}`)

    /** A task's title for a mutation that does not return one; empty if it is gone. */
    const suffix = (id: TaskId) =>
      store.get(id).pipe(
        Effect.map((task) => ` - ${task.title}`),
        Effect.orElseSucceed(() => ""),
      )

    return TodoStore.of({
      ...store,
      add: (input, placement) => mutate(store.add(input, placement), verb("add")),
      update: (id, patch) => mutate(store.update(id, patch), verb("edit")),
      move: (id, placement) => mutate(store.move(id, placement), verb("move")),
      complete: (id) => mutate(store.complete(id), verb("complete")),
      cancel: (id, reason) => mutate(store.cancel(id, reason), verb("cancel")),
      reopen: (id) => mutate(store.reopen(id), verb("reopen")),
      promote: (id) => mutate(store.promote(id), verb("promote")),
      remove: (id) => mutate(store.remove(id), () => Effect.succeed(`todo: remove ${id}`)),
      renameGroup: (from, to) =>
        mutate(store.renameGroup(from, to), () =>
          Effect.succeed(`todo: rename group ${from} to ${to}`),
        ),
      comment: (id, input) =>
        mutate(store.comment(id, input), () =>
          Effect.map(suffix(id), (title) => `todo: comment on ${id}${title}`),
        ),
    })
  })
