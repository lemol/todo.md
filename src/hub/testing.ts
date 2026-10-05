/**
 * Test helpers for the hub (`@lemol/todo-md/hub/testing`). Only tests may
 * import this module.
 */

import { Effect, Layer, Schema } from "effect"
import { MemoryTodoStore, TaskInput, TodoStore } from "../spec/index.ts"
import { SourceError } from "./errors.ts"
import type { Source } from "./Source.ts"

export const MemoryConfig = Schema.Struct({
  title: Schema.optional(Schema.String),
  /** Tasks added to the store when it is first opened. */
  tasks: Schema.optional(Schema.Array(TaskInput)),
})
export type MemoryConfig = typeof MemoryConfig.Type

/** Optional source behavior a test adds to `memorySource`. */
export type MemoryHooks = Partial<
  Pick<
    Source<MemoryConfig>,
    "kind" | "defaultName" | "prepare" | "sync" | "changes" | "status" | "beforeRemove" | "owns"
  >
>

/**
 * A fresh `memory` source. `hooks` add behavior; `kind` renames the source, so
 * a test can load two. Each project's store is a `MemoryTodoStore` seeded
 * from `tasks` on first open and kept by project name for as long as this
 * source value lives, so state survives rebuilt layers within a test.
 */
export const memorySource = (hooks: MemoryHooks = {}): Source<MemoryConfig> => {
  const stores = new Map<string, TodoStore["Service"]>()

  const storeFor = (name: string, config: MemoryConfig) =>
    Effect.gen(function* () {
      const existing = stores.get(name)

      if (existing !== undefined) return existing

      const store = yield* TodoStore.pipe(
        Effect.provide(
          MemoryTodoStore.layer(config.title === undefined ? {} : { title: config.title }),
        ),
      )

      const seedError = (error: { readonly _tag: string }) =>
        new SourceError({ name, message: `could not seed ${name}: ${error._tag}`, cause: error })

      for (const task of config.tasks ?? []) {
        yield* Effect.mapError(store.add(task), seedError)
      }

      stores.set(name, store)

      return store
    })

  return {
    kind: "memory",
    config: MemoryConfig,
    location: () => "memory",
    open: (project) => Layer.effect(TodoStore, storeFor(project.name, project.config)),
    ...hooks,
  }
}
