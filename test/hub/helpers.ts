import { test } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import {
  Context,
  type Duration,
  Effect,
  FileSystem,
  Layer,
  Option,
  PubSub,
  Queue,
  type Scope,
  Stream,
} from "effect"
import { type AnySource, Hub, type HubChange } from "../../src/hub/index.ts"
import type { MemoryHooks } from "../../src/hub/testing.ts"
import { Disk } from "../fs/helpers.ts"

export { Disk, diskWith, md } from "../fs/helpers.ts"

/**
 * A hub whose home is `<disk root>/.todo-md` and whose `~` is the disk root.
 * Several hubs on one disk share a home, like separate processes. `wrapFs`
 * replaces the hub's `FileSystem`, to observe or fail its calls; `autoSync` is
 * passed to `Hub.layer`.
 */
export const hubOn = (
  sources: ReadonlyArray<AnySource>,
  options: {
    readonly wrapFs?: (fs: FileSystem.FileSystem) => FileSystem.FileSystem
    readonly autoSync?: Duration.Input
  } = {},
): Effect.Effect<Hub["Service"], never, Disk | Scope.Scope> =>
  Effect.gen(function* () {
    const { root } = yield* Disk
    const layer = Hub.layer({
      home: `${root}/.todo-md`,
      userHome: root,
      sources,
      ...(options.autoSync === undefined ? {} : { autoSync: options.autoSync }),
    })
    const { wrapFs } = options
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

/** A `changes` hook for `memorySource` that reports watcher starts and stops and emits on demand. */
export interface Watchers {
  /** Project names, as their watchers start. */
  readonly started: Queue.Queue<string>
  /** Project names, as their watchers stop. */
  readonly stopped: Queue.Queue<string>
  /** Makes project `name`'s watcher emit once. */
  emit(name: string): Effect.Effect<void>
  readonly changes: NonNullable<MemoryHooks["changes"]>
}

export const makeWatchers: Effect.Effect<Watchers> = Effect.gen(function* () {
  const started = yield* Queue.unbounded<string>()
  const stopped = yield* Queue.unbounded<string>()
  const emitted = yield* PubSub.unbounded<string>()
  return {
    started,
    stopped,
    emit: (name) => Effect.asVoid(PubSub.publish(emitted, name)),
    // Subscribed before `started` is reported, so an emit after `started` is never lost.
    changes: (project) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(emitted)
          yield* Queue.offer(started, project.name)
          return Stream.fromSubscription(subscription).pipe(
            Stream.filter((name) => name === project.name),
            Stream.map(() => undefined),
          )
        }),
      ).pipe(Stream.ensuring(Queue.offer(stopped, project.name))),
  }
})

/**
 * Subscribes to `hub.changes` for the rest of the test and waits until the
 * hub's watchers run: `started` must receive a name, so some registered
 * project must use a `makeWatchers` source. The hub subscribes before it
 * starts watchers, so no event after this returns is missed.
 */
export const listen = (hub: Hub["Service"], started: Queue.Queue<string>) =>
  Effect.gen(function* () {
    const events = yield* Queue.unbounded<HubChange>()
    const fiber = yield* hub.changes.pipe(
      Stream.runForEach((change) => Queue.offer(events, change)),
      Effect.forkScoped,
    )
    const first = yield* Queue.take(started)
    return { events, fiber, first }
  })
