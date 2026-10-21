import { expect, test } from "bun:test"
import { Context, DateTime, Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { effectTest } from "../../src/spec/testing.ts"
import { runEffectTest } from "../../src/spec/testing/effectTest.ts"

class Greeting extends Context.Service<Greeting, { readonly text: string }>()("test/Greeting") {}

effectTest(
  "runs on the test clock, which starts at 0 and moves only when adjusted",
  Effect.gen(function* () {
    expect(DateTime.toEpochMillis(yield* DateTime.now)).toBe(0)
    yield* TestClock.adjust("1 minute")
    expect(DateTime.toEpochMillis(yield* DateTime.now)).toBe(60_000)
  }),
)

effectTest(
  "provides the given layer",
  Effect.gen(function* () {
    expect((yield* Greeting).text).toBe("hello")
  }),
  Layer.succeed(Greeting, Greeting.of({ text: "hello" })),
)

test("closes the test's scope before the layer's", async () => {
  const closed: Array<string> = []
  const layer = Layer.effect(
    Greeting,
    Effect.acquireRelease(Effect.succeed(Greeting.of({ text: "hello" })), () =>
      Effect.sync(() => closed.push("layer")),
    ),
  )

  await runEffectTest(
    Effect.addFinalizer(() => Effect.sync(() => closed.push("test"))),
    layer,
  )
  expect(closed).toEqual(["test", "layer"])
})
