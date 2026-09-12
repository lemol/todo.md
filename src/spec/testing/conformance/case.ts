import type { Effect } from "effect"
import type { Capabilities, TodoStore } from "../../TodoStore.ts"

/**
 * One executable statement of the spec's operation semantics. `run` gets a
 * fresh, empty store and fails (usually as a defect from `equal`) when the
 * store misbehaves. Cases whose `requires` capabilities the store lacks are
 * skipped.
 */
export interface ConformanceCase {
  readonly name: string
  readonly requires?: ReadonlyArray<keyof Capabilities>
  readonly run: Effect.Effect<void, unknown, TodoStore>
}
