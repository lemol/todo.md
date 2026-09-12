import { test } from "bun:test"
import { Effect, Layer, type Scope } from "effect"
import { TestClock, TestConsole } from "effect/testing"

const TestEnv = Layer.mergeAll(TestConsole.layer, TestClock.layer())

/**
 * Registers a `bun:test` test that runs `effect` with a scope, Effect's
 * `TestClock` (time starts at 0 and only moves with `TestClock.adjust` or
 * `TestClock.setTime`) and `TestConsole`. Pass `layer` to provide services.
 */
export function effectTest<A, E>(name: string, effect: Effect.Effect<A, E, Scope.Scope>): void
export function effectTest<A, E, R, LE>(
  name: string,
  effect: Effect.Effect<A, E, R | Scope.Scope>,
  layer: Layer.Layer<R, LE>,
): void
export function effectTest<A, E, R, LE>(
  name: string,
  effect: Effect.Effect<A, E, R | Scope.Scope>,
  layer?: Layer.Layer<R, LE>,
): void {
  const provided = (layer === undefined ? effect : Effect.provide(effect, layer)) as Effect.Effect<
    A,
    E | LE,
    Scope.Scope
  >
  test(name, () => Effect.runPromise(provided.pipe(Effect.scoped, Effect.provide(TestEnv))))
}
