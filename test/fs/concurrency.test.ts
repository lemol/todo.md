import { expect, test } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import * as FsTodoStore from "../../src/fs/FsTodoStore.ts"
import { TodoStore } from "../../src/spec/index.ts"
import { Disk, listWith, md } from "./helpers.ts"

// Real clock: two stores over the same directory, as two agents would have.
test("concurrent changes from separate stores do not lose writes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* TodoStore
      const { root } = yield* Disk
      const other = yield* TodoStore.pipe(
        Effect.provide(FsTodoStore.layer({ root })),
        Effect.provide(BunServices.layer),
      )

      yield* Effect.all(
        Array.from({ length: 10 }, (_, i) =>
          (i % 2 === 0 ? store : other).add({ title: `Task ${i}` }),
        ),
        { concurrency: "unbounded" },
      )
      const ids = (yield* store.load()).ungrouped.map((task) => Number(task.id))
      expect(ids.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    }).pipe(Effect.provide(listWith({ "TODO.md": md("# T") }))),
  ))
