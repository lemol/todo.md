/**
 * The hub's change feed: a `PubSub` of `HubChange`s. Watchers (one fiber per
 * watched project, plus a watch on `projects.yaml`) are reference-counted:
 * the first subscriber starts them, the last one leaving stops them.
 */

import {
  Deferred,
  Effect,
  FiberMap,
  FileSystem,
  Path,
  PubSub,
  RcRef,
  type Scope,
  Semaphore,
  Stream,
} from "effect"
import { TodoStore } from "../spec/index.ts"
import type { RegistryError } from "./errors.ts"
import { registryFile } from "./registry.ts"
import type { SourceEnv } from "./Source.ts"

export type HubChange =
  | { readonly kind: "changed" | "synced"; readonly project: string }
  | { readonly kind: "registry" }

/** A project the hub watches while `changes` has subscribers. */
export interface Watched {
  readonly name: string
  /** Changes when the project's entry does; a new key restarts the watcher. */
  readonly key: string
  readonly changes: Stream.Stream<void, never, SourceEnv>
}

export interface ChangesOptions {
  readonly home: string
  /** The projects to watch now. */
  readonly watched: Effect.Effect<ReadonlyArray<Watched>, RegistryError>
  /** Runs when `projects.yaml` changes on disk, before `registry` is published. */
  readonly onRegistryFile: Effect.Effect<void>
}

export interface Changes {
  /** Acquires a pubsub subscription and starts source watchers before returning. */
  readonly subscribe: Effect.Effect<Stream.Stream<HubChange>, never, Scope.Scope>
  readonly stream: Stream.Stream<HubChange>
  publish(change: HubChange): Effect.Effect<void>
  /** Starts and stops project watchers to match `watched`; a no-op while none run. */
  readonly reconcile: Effect.Effect<void>
}

export const makeChanges = (
  options: ChangesOptions,
): Effect.Effect<Changes, never, Scope.Scope | SourceEnv> =>
  Effect.gen(function* () {
    const env = yield* Effect.context<SourceEnv>()
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const pubsub = yield* Effect.acquireRelease(PubSub.unbounded<HubChange>(), PubSub.shutdown)
    const publish = (change: HubChange) => Effect.asVoid(PubSub.publish(pubsub, change))
    let running: Effect.Effect<void> | undefined

    // A missing directory cannot be watched, so the home is created first.
    const registryChanges = Stream.unwrap(
      Effect.as(fs.makeDirectory(options.home, { recursive: true }), fs.watch(options.home)),
    ).pipe(
      Stream.filter((event) => path.basename(event.path) === registryFile),
      Stream.debounce("100 millis"),
    )

    const start = Effect.gen(function* () {
      const fibers = yield* FiberMap.make<string>()
      const keys = new Map<string, string>()
      const lock = yield* Semaphore.make(1)
      const watch = (project: Watched, ready: Deferred.Deferred<void>) =>
        Effect.scoped(
          Effect.gen(function* () {
            // Acquire the source stream before announcing readiness. This makes
            // the hub subscription handshake observable to callers.
            const pull = yield* Stream.toPull(project.changes)
            yield* Deferred.succeed(ready, undefined)
            yield* Stream.runForEach(Stream.fromPull(Effect.succeed(pull)), () =>
              publish({ kind: "changed", project: project.name }),
            )
          }),
        ).pipe(
          // A failed acquisition must still release the subscription handshake;
          // otherwise one broken source blocks every subscriber forever.
          Effect.ensuring(Deferred.succeed(ready, undefined)),
          Effect.catchDefect((defect) =>
            Effect.logWarning(`stopped watching ${project.name}`, defect),
          ),
          Effect.provideContext(env),
        )
      const reconcile = lock.withPermit(
        Effect.gen(function* () {
          const wanted = yield* options.watched
          const names = new Set(wanted.map((project) => project.name))
          for (const name of [...keys.keys()]) {
            if (names.has(name)) continue
            keys.delete(name)
            yield* FiberMap.remove(fibers, name)
          }
          for (const project of wanted) {
            if (keys.get(project.name) === project.key) continue
            keys.set(project.name, project.key)
            const ready = yield* Deferred.make<void>()
            yield* FiberMap.run(fibers, project.name, { startImmediately: true })(
              watch(project, ready),
            )
            yield* Deferred.await(ready)
          }
        }).pipe(
          // An unreadable registry keeps the watchers that run.
          Effect.catch((error) =>
            Effect.logWarning(`could not update project watchers: ${error.message}`),
          ),
        ),
      )
      // Set before the first reconcile, so a concurrent registry edit waits for it and then applies.
      running = reconcile
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          running = undefined
        }),
      )
      yield* reconcile
      yield* registryChanges.pipe(
        Stream.runForEach(() =>
          options.onRegistryFile.pipe(
            Effect.andThen(reconcile),
            Effect.andThen(publish({ kind: "registry" })),
          ),
        ),
        Effect.catch((error) =>
          Effect.logWarning(`stopped watching ${registryFile}: ${error.message}`),
        ),
        Effect.forkScoped,
      )
    })
    const watchers = yield* RcRef.make({ acquire: start })

    const subscribe = Effect.gen(function* () {
      // Subscribe before starting watchers, so their first events are not missed.
      const subscription = yield* PubSub.subscribe(pubsub)
      yield* RcRef.get(watchers)
      return Stream.fromSubscription(subscription)
    })

    return {
      subscribe,
      stream: Stream.unwrap(subscribe),
      publish,
      reconcile: Effect.suspend(() => running ?? Effect.void),
    }
  })

/** `store`, running `notify` after each successful mutation. */
export const notifying = (
  store: TodoStore["Service"],
  notify: Effect.Effect<void>,
): TodoStore["Service"] => {
  const after = <A, E>(effect: Effect.Effect<A, E>) => Effect.tap(effect, () => notify)
  return TodoStore.of({
    ...store,
    add: (input, placement) => after(store.add(input, placement)),
    update: (id, patch) => after(store.update(id, patch)),
    move: (id, placement) => after(store.move(id, placement)),
    complete: (id) => after(store.complete(id)),
    reopen: (id) => after(store.reopen(id)),
    remove: (id) => after(store.remove(id)),
    renameGroup: (from, to) => after(store.renameGroup(from, to)),
    comment: (id, input) => after(store.comment(id, input)),
  })
}
