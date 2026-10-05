import { describe, test } from "bun:test"
import { Effect, type Layer } from "effect"
import type { Capabilities } from "../../TodoStore.ts"
import { TodoStore } from "../../TodoStore.ts"
import { effectTest } from "../effectTest.ts"
import { addingCases } from "./adding.ts"
import { cancellingCases } from "./cancelling.ts"
import { type ConformanceCase, type Seed, Seeding } from "./case.ts"
import { commentCases } from "./comments.ts"
import { groupCases } from "./groups.ts"
import { lifecycleCases } from "./lifecycle.ts"
import { movingCases } from "./moving.ts"
import { promotionCases } from "./promotion.ts"
import { readingCases } from "./reading.ts"
import { updatingCases } from "./updating.ts"

/** Every conformance case, as runner-agnostic Effects. */
export const conformanceCases: ReadonlyArray<ConformanceCase> = [
  ...readingCases,
  ...addingCases,
  ...updatingCases,
  ...movingCases,
  ...lifecycleCases,
  ...cancellingCases,
  ...groupCases,
  ...commentCases,
  ...promotionCases,
]

export interface ConformanceOptions {
  /**
   * How to put tasks in the store for cases that only need a starting state.
   * A store without `add` needs one, or those cases are skipped.
   */
  readonly seed?: Seed
}

/** Why a case cannot run against this store, or `undefined` when it can. */
const skipReason = (
  testCase: ConformanceCase,
  capabilities: Capabilities,
  options: ConformanceOptions,
): string | undefined => {
  const missing = (testCase.requires ?? []).filter((capability) => !capabilities[capability])

  if (missing.length > 0) return `needs ${missing.join(" and ")}`

  if (testCase.setup === true && !capabilities.add && options.seed === undefined) {
    return "needs add or a seed"
  }

  return undefined
}

/**
 * Registers every conformance case with `bun:test`. `layer` must build a fresh,
 * empty store each time it is provided; each case gets its own. The store's
 * capabilities are read once up front, so a case the store cannot run is
 * reported as skipped rather than quietly passing.
 *
 * Reading them makes the body `async`. Bun awaits it before running anything,
 * but a runner that did not would register no case at all and still exit 0,
 * losing the whole suite silently. `registers its cases` is the tripwire: it
 * is registered synchronously and only passes once the body has run.
 */
export const runConformance = <E>(
  name: string,
  layer: Layer.Layer<TodoStore, E>,
  options: ConformanceOptions = {},
): void =>
  describe(`${name} conforms to TodoStore`, async () => {
    let registrar: "done" | "unfinished" = "unfinished"
    test("registers its cases", () => {
      if (registrar === "unfinished") {
        throw new Error("no case was registered: this runner does not await an async describe body")
      }
    })
    let capabilities: Capabilities

    try {
      capabilities = await Effect.runPromise(
        TodoStore.pipe(
          Effect.map((store) => store.capabilities),
          Effect.provide(layer),
          Effect.scoped,
        ),
      )
    } catch (cause) {
      // The body did run; `builds a store` is what reports the failure.
      registrar = "done"
      test("builds a store", () => {
        throw cause
      })

      return
    }

    for (const testCase of conformanceCases) {
      const reason = skipReason(testCase, capabilities, options)

      if (reason === undefined) {
        effectTest(
          testCase.name,
          options.seed === undefined
            ? testCase.run
            : Effect.provideService(testCase.run, Seeding, options.seed),
          layer,
        )
      } else test.skip(`${testCase.name} (${reason})`, () => {})
    }

    registrar = "done"
  })
