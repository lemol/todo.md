import { describe } from "bun:test"
import { Effect, type Layer } from "effect"
import { TodoStore } from "../../TodoStore.ts"
import { effectTest } from "../effectTest.ts"
import { addingCases } from "./adding.ts"
import type { ConformanceCase } from "./case.ts"
import { lifecycleCases } from "./lifecycle.ts"
import { movingCases } from "./moving.ts"
import { readingCases } from "./reading.ts"
import { updatingCases } from "./updating.ts"

/** Every conformance case, as runner-agnostic Effects. */
export const conformanceCases: ReadonlyArray<ConformanceCase> = [
  ...readingCases,
  ...addingCases,
  ...updatingCases,
  ...movingCases,
  ...lifecycleCases,
]

/**
 * Registers every conformance case with `bun:test`. `layer` must build a fresh,
 * empty store each time it is provided; each case gets its own.
 */
export const runConformance = <E>(name: string, layer: Layer.Layer<TodoStore, E>): void =>
  describe(`${name} conforms to TodoStore`, () => {
    for (const testCase of conformanceCases) {
      effectTest(
        testCase.name,
        Effect.gen(function* () {
          const { capabilities } = yield* TodoStore
          if (testCase.requires?.some((capability) => !capabilities[capability])) return
          yield* testCase.run
        }),
        layer,
      )
    }
  })
