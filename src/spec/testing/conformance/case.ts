import { Context, Effect } from "effect"
import type { Placement, Task, TaskInput } from "../../model.ts"
import { type Capabilities, TodoStore } from "../../TodoStore.ts"

/**
 * One executable statement of the spec's operation semantics. `run` gets a
 * fresh, empty store and fails (usually as a defect from `equal`) when the
 * store misbehaves. Cases whose `requires` capabilities the store lacks are
 * skipped.
 */
export interface ConformanceCase {
  readonly name: string
  readonly requires?: ReadonlyArray<keyof Capabilities>
  /**
   * The case puts tasks in the store with `given` before asserting, rather
   * than exercising `add` itself. Such a case needs either the `add`
   * capability or a `seed` (see `ConformanceOptions`).
   */
  readonly setup?: boolean
  readonly run: Effect.Effect<void, unknown, TodoStore>
}

/** A task `given` puts in the store. */
export type SeedTask = TaskInput & {
  /** Where the task goes; needs the store's `groups` or `reorder` capability. */
  readonly placement?: Placement
  /** Completes the task once it exists, for a case that needs a done task. */
  readonly done?: boolean
}

/**
 * Puts tasks into a fresh store some other way than `add`, returning them
 * with the IDs the store assigned, in the order asked for.
 */
export type Seed = (
  tasks: ReadonlyArray<SeedTask>,
) => Effect.Effect<ReadonlyArray<Task>, unknown, TodoStore>

/** The `seed` the current `runConformance` call was given, if any. */
export const Seeding = Context.Reference<Seed | undefined>("@lemol/todo-md/spec/testing/Seeding", {
  defaultValue: () => undefined,
})

/**
 * The state a case starts from: the seed when the runner has one, and `add`
 * otherwise. Cases that assert something about `add` itself call `store.add`
 * directly and declare `requires: ["add"]`; every other case uses this, so a
 * store that cannot add is still held to the rest of the spec.
 */
export const given = <const Tasks extends ReadonlyArray<SeedTask>>(
  ...tasks: Tasks
): Effect.Effect<{ readonly [K in keyof Tasks]: Task }, unknown, TodoStore> =>
  Effect.gen(function* () {
    const seed = yield* Seeding
    const created: ReadonlyArray<Task> = yield* seed === undefined
      ? viaAdd(tasks)
      : seed(tasks).pipe(Effect.tap((seeded) => checkSeeded(tasks, seeded)))

    // The shape is the runner's promise, checked above for a `seed`.
    return created as unknown as { readonly [K in keyof Tasks]: Task }
  })

const viaAdd = Effect.fn("given.viaAdd")(function* (tasks: ReadonlyArray<SeedTask>) {
  const store = yield* TodoStore
  const created: Array<Task> = []

  for (const task of tasks) {
    const { placement, done, ...input } = task
    const added = yield* store.add(input, placement)

    created.push(done === true ? yield* store.complete(added.id) : added)
  }

  return created
})

/**
 * A seed that drops a task or leaves one open would otherwise fail the case
 * as a spec violation, sending an adapter author to the wrong file.
 */
const checkSeeded = (
  asked: ReadonlyArray<SeedTask>,
  seeded: ReadonlyArray<Task>,
): Effect.Effect<void> => {
  const wrong = (message: string) => Effect.die(new Error(`the seed ${message}`))

  if (seeded.length !== asked.length) {
    return wrong(`returned ${seeded.length} of the ${asked.length} tasks it was given`)
  }

  const open = asked.findIndex(
    (task, index) => task.done === true && seeded[index]?.status !== "done",
  )

  return open === -1 ? Effect.void : wrong(`left task ${open + 1} of ${asked.length} open`)
}
