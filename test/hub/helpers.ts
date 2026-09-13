import { test } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import {
  Context,
  type Duration,
  Effect,
  FileSystem,
  Layer,
  Option,
  Queue,
  type Scope,
} from "effect"
import { type AnySource, Hub } from "../../src/hub/index.ts"
import { Disk } from "../fs/helpers.ts"

export { Disk, diskWith, md } from "../fs/helpers.ts"

/**
 * A hub whose home is `<disk root>/.todo-md` and whose `~` is the disk root.
 * Several hubs on one disk share a home, like separate processes. `wrapFs`
 * replaces the hub's `FileSystem`, to observe or fail its calls.
 */
export const hubOn = (
  sources: ReadonlyArray<AnySource>,
  wrapFs?: (fs: FileSystem.FileSystem) => FileSystem.FileSystem,
): Effect.Effect<Hub["Service"], never, Disk | Scope.Scope> =>
  Effect.gen(function* () {
    const { root } = yield* Disk
    const layer = Hub.layer({ home: `${root}/.todo-md`, userHome: root, sources })
    const wrapped =
      wrapFs === undefined
        ? layer
        : layer.pipe(
            Layer.provide(
              Layer.effect(FileSystem.FileSystem, Effect.map(FileSystem.FileSystem, wrapFs)),
            ),
          )
    const context = yield* Layer.build(wrapped.pipe(Layer.provide(BunServices.layer)))
    return Context.get(context, Hub)
  })

/** Like `effectTest`, but on the real clock: for file watches, debounces and real sleeps. */
export const liveTest = <A, E>(
  name: string,
  effect: Effect.Effect<A, E, Disk | Scope.Scope>,
  disk: Layer.Layer<Disk>,
) => test(name, () => Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(disk))), 30_000)

/** The next item of `queue` within `within`, or none. */
export const takeWithin = <A>(queue: Queue.Dequeue<A>, within: Duration.Input) =>
  Effect.timeoutOption(Queue.take(queue), within)

/**
 * Runs `action` then `check` until `check` finds something, up to `attempts`
 * times. File watches start asynchronously, so a test repeats the change that
 * should be seen instead of sleeping and hoping the watch is ready. `action`
 * is run as given each time: wrap it in `Effect.suspend` to vary it.
 */
export const eventually = <A, E, R>(
  action: Effect.Effect<unknown, E, R>,
  check: Effect.Effect<Option.Option<A>, E, R>,
  attempts = 25,
): Effect.Effect<Option.Option<A>, E, R> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < attempts; attempt++) {
      yield* action
      const found = yield* check
      if (Option.isSome(found)) return found
    }
    return Option.none()
  })
