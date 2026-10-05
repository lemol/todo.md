import { Effect, Layer } from "effect"
import { MemoryTodoStore, type Task, TodoStore, Unsupported } from "../../src/spec/index.ts"
import { runConformance, type SeedTask } from "../../src/spec/testing.ts"

/**
 * `add` and `remove` are capabilities (spec §1.5), so the suite has to hold a
 * store that lacks them to the rest of the spec. These stores stand in for a
 * source that mirrors work it does not own, such as Jira.
 */

/**
 * The store each wrapper was built from. A wrapper's `add` fails, so a case
 * that reaches for it is caught rather than quietly served; `seed` needs the
 * store underneath to set a case's state up at all.
 */
const underneath = new WeakMap<TodoStore["Service"], TodoStore["Service"]>()

const without = (capability: "add" | "remove"): Layer.Layer<TodoStore> =>
  Layer.effect(
    TodoStore,
    Effect.gen(function* () {
      const store = yield* TodoStore
      const wrapped = TodoStore.of({
        ...store,
        capabilities: { ...store.capabilities, [capability]: false },
        [capability]: () => Effect.fail(new Unsupported({ operation: capability })),
      })

      underneath.set(wrapped, store)

      return wrapped
    }),
  ).pipe(Layer.provide(MemoryTodoStore.layer()))

const seed = (tasks: ReadonlyArray<SeedTask>) =>
  Effect.gen(function* () {
    const store = yield* TodoStore
    const base = underneath.get(store)

    if (base === undefined) return yield* Effect.die(new Error("the store has nothing underneath"))

    const created: Array<Task> = []

    for (const task of tasks) {
      const { placement, done, ...input } = task
      const added = yield* base.add(input, placement)
      created.push(done === true ? yield* base.complete(added.id) : added)
    }

    return created
  })

// With a seed, every case that does not exercise `add` itself still runs.
runConformance("MemoryTodoStore without add, given a seed", without("add"), { seed })

// Without one, the cases that need a starting state are skipped, not failed.
runConformance("MemoryTodoStore without add or a seed", without("add"))

runConformance("MemoryTodoStore without remove", without("remove"))
