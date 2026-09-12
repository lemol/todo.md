import { Effect, Schema } from "effect"
import { ValidationError } from "./errors.ts"
import { findCycle } from "./graph.ts"
import type { Task } from "./model.ts"

/** Decodes `value` with `schema`, failing with `ValidationError` instead of a schema error. */
export const validate = <S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  value: unknown,
): Effect.Effect<S["Type"], ValidationError> =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError((error) => new ValidationError({ issues: [error.message] })),
  )

/** Fails with `ValidationError` if the tasks' dependencies contain a self-dependency or a cycle (spec §1.6). */
export const ensureAcyclic = (tasks: Iterable<Task>): Effect.Effect<void, ValidationError> => {
  const cycle = findCycle(new Map(Array.from(tasks, (task) => [task.id, task.dependsOn])))
  return cycle === undefined
    ? Effect.void
    : Effect.fail(new ValidationError({ issues: [`dependency cycle: ${cycle.join(" → ")}`] }))
}

/** Removes repeated values, keeping the first occurrence of each. */
export const unique = <A>(values: ReadonlyArray<A>): ReadonlyArray<A> => [...new Set(values)]
