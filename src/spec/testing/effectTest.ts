import { test } from "bun:test"
import { Effect, Layer, type Scope } from "effect"
import { TestClock, TestConsole } from "effect/testing"

const TestEnv = Layer.mergeAll(TestConsole.layer, TestClock.layer())

/**
 * Runs `effect` with the test services, closing the test's scope before
 * `layer`'s, so what the test built over the layer's services is gone before
 * they are.
 */
export const runEffectTest = <A, E, R, LE>(
  effect: Effect.Effect<A, E, R | Scope.Scope>,
  layer?: Layer.Layer<R, LE>,
): Promise<A> => {
  const scoped = Effect.scoped(effect) as Effect.Effect<A, E, R>
  const provided = (layer === undefined ? scoped : Effect.provide(scoped, layer)) as Effect.Effect<
    A,
    E | LE
  >

  return Effect.runPromise(provided.pipe(Effect.provide(TestEnv)))
}

/**
 * Registers a `bun:test` test that runs `effect` with a scope, Effect's
 * `TestClock` (time starts at 0 and only moves with `TestClock.adjust` or
 * `TestClock.setTime`) and `TestConsole`. Pass `layer` to provide services.
 * The test's scope closes before the layer's.
 */
export function effectTest<A, E>(
  name: string,
  effect: Effect.Effect<A, E, Scope.Scope>,
  timeout?: number,
): void
export function effectTest<A, E, R, LE>(
  name: string,
  effect: Effect.Effect<A, E, R | Scope.Scope>,
  layer: Layer.Layer<R, LE>,
  timeout?: number,
): void
export function effectTest<A, E, R, LE>(
  name: string,
  effect: Effect.Effect<A, E, R | Scope.Scope>,
  layerOrTimeout?: Layer.Layer<R, LE> | number,
  timeout?: number,
): void {
  const layer = typeof layerOrTimeout === "number" ? undefined : layerOrTimeout
  const t = typeof layerOrTimeout === "number" ? layerOrTimeout : timeout

  test(name, () => runEffectTest(effect, layer), t)
}
