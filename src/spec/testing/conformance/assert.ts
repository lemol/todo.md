import { deepStrictEqual } from "node:assert/strict"
import { Effect } from "effect"
import type { Task } from "../../model.ts"
import { TodoStore } from "../../TodoStore.ts"

/** Asserts deep equality; a mismatch fails the case as a defect. */
export const equal = <A>(actual: A, expected: A, message?: string): void =>
  deepStrictEqual(actual, expected, message)

/** Runs `effect`, asserting it fails with an error whose `_tag` is `tag`. */
export const failsWith = <A, E extends { readonly _tag: string }, R>(
  effect: Effect.Effect<A, E, R>,
  tag: E["_tag"],
): Effect.Effect<E, never, R> =>
  Effect.flip(effect).pipe(
    Effect.tap((error) => Effect.sync(() => equal(error._tag, tag, `expected ${tag}`))),
    Effect.orDie,
  )

const section = (name: string, tasks: ReadonlyArray<Task>) =>
  [name, tasks.map((task) => task.id)] as const

/** The open tasks' IDs per section: the ungrouped section (named "") first, then each group. */
export const layout = Effect.gen(function* () {
  const list = yield* (yield* TodoStore).load()
  return [
    section("", list.ungrouped),
    ...list.groups.map((group) => section(group.name, group.tasks)),
  ]
})
