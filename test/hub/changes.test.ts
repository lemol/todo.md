import { describe, expect } from "bun:test"
import { Effect, Fiber, Layer, Option, Queue, Stream } from "effect"
import { fsSource, type HubChange, type Source } from "../../src/hub/index.ts"
import { type MemoryConfig, memorySource } from "../../src/hub/testing.ts"
import { effectTest } from "../../src/spec/testing.ts"
import {
  Disk,
  diskWith,
  eventually,
  hubOn,
  listen,
  liveTest,
  makeWatchers,
  md,
  takeWithin,
} from "./helpers.ts"

const withProbe = (...more: ReadonlyArray<string>) =>
  diskWith({
    ".todo-md/projects.yaml": md("projects:", "  probe:", "    source: probe", ...more),
  })

describe("changes", () => {
  effectTest(
    "a source's changes arrive as changed events",
    Effect.gen(function* () {
      const watchers = yield* makeWatchers
      const hub = yield* hubOn([memorySource({ kind: "probe", changes: watchers.changes })])
      const { events, first } = yield* listen(hub, watchers.started)

      expect(first).toBe("probe")
      yield* watchers.emit("probe")
      expect(yield* Queue.take(events)).toEqual({ kind: "changed", project: "probe" })
    }),
    withProbe(),
  )

  effectTest(
    "watchers run only while something subscribes",
    Effect.gen(function* () {
      const watchers = yield* makeWatchers
      const hub = yield* hubOn([memorySource({ kind: "probe", changes: watchers.changes })])

      yield* (yield* hub.todo("probe")).add({ title: "Unwatched" })
      yield* hub.projects()
      expect(yield* Queue.size(watchers.started)).toBe(0)
      const { fiber, first } = yield* listen(hub, watchers.started)

      expect(first).toBe("probe")
      yield* Fiber.interrupt(fiber)
      expect(yield* Queue.take(watchers.stopped)).toBe("probe")
    }),
    withProbe(),
  )

  effectTest(
    "mutations publish changed only for sources without changes",
    Effect.gen(function* () {
      const watchers = yield* makeWatchers
      const hub = yield* hubOn([
        memorySource({ kind: "probe", changes: watchers.changes }),
        memorySource(),
      ])

      const { events } = yield* listen(hub, watchers.started)

      yield* (yield* hub.todo("probe")).add({ title: "Watched by its source" })
      yield* (yield* hub.todo("m")).add({ title: "Reported by the hub" })
      expect(yield* Queue.take(events)).toEqual({ kind: "changed", project: "m" })
      expect(yield* Queue.size(events)).toBe(0)
    }),
    withProbe("  m:", "    source: memory"),
  )

  effectTest(
    "the hub's own registry edits publish registry and start or stop watchers",
    Effect.gen(function* () {
      const watchers = yield* makeWatchers
      const hub = yield* hubOn([memorySource({ kind: "probe", changes: watchers.changes })])
      const { events } = yield* listen(hub, watchers.started)

      yield* hub.add({ name: "two", source: "probe", config: {} })
      expect(yield* Queue.take(watchers.started)).toBe("two")
      expect(yield* Queue.take(events)).toEqual({ kind: "registry" })
      yield* hub.rename("two", "three")
      expect(yield* Queue.take(watchers.stopped)).toBe("two")
      expect(yield* Queue.take(watchers.started)).toBe("three")
      expect(yield* Queue.take(events)).toEqual({ kind: "registry" })
      yield* hub.remove("three")
      expect(yield* Queue.take(watchers.stopped)).toBe("three")
      expect(yield* Queue.take(events)).toEqual({ kind: "registry" })
    }),
    withProbe(),
  )

  liveTest(
    "a defecting watcher does not block healthy change subscriptions",
    Effect.gen(function* () {
      const watchers = yield* makeWatchers
      const brokenStarted = yield* Queue.unbounded<void>()
      const hub = yield* hubOn([
        memorySource({
          kind: "broken",
          changes: () =>
            Stream.unwrap(
              Effect.gen(function* () {
                yield* Queue.offer(brokenStarted, undefined)

                return yield* Effect.die("broken watcher")
              }),
            ),
        }),
        memorySource({ kind: "healthy", changes: watchers.changes }),
      ])

      const subscription = yield* Effect.timeoutOption(hub.subscribeChanges, "1 second")

      expect(yield* Queue.size(brokenStarted)).toBe(1)
      expect(Option.isSome(subscription)).toBe(true)

      if (Option.isNone(subscription)) return

      const events = yield* Queue.unbounded<HubChange>()

      yield* subscription.value.pipe(
        Stream.runForEach((change) => Queue.offer(events, change)),
        Effect.forkScoped,
      )
      yield* watchers.emit("healthy")
      expect(yield* Queue.take(events)).toEqual({ kind: "changed", project: "healthy" })
    }),
    withProbe("  healthy:", "    source: healthy", "  broken:", "    source: broken"),
  )

  liveTest(
    "a registry edit from another hub publishes registry",
    Effect.gen(function* () {
      const [watching, editing] = [
        yield* hubOn([memorySource({ kind: "probe" })]),
        yield* hubOn([memorySource({ kind: "probe" })]),
      ]

      const events = yield* Queue.unbounded<HubChange>()

      yield* watching.changes.pipe(
        Stream.runForEach((change) => Queue.offer(events, change)),
        Effect.forkScoped,
      )
      let added = 0
      const seen = yield* eventually(
        // Suspended, so each attempt adds a new name.
        Effect.suspend(() => editing.add({ name: `p${added++}`, source: "probe", config: {} })),
        takeWithin(events, "300 millis"),
      )

      expect(seen).toEqual(Option.some({ kind: "registry" }))
    }),
    withProbe(),
  )

  liveTest(
    "unregistered projects opened by resolve are watched",
    Effect.gen(function* () {
      const disk = yield* Disk
      const hub = yield* hubOn([fsSource])
      const events = yield* Queue.unbounded<HubChange>()

      yield* hub.changes.pipe(
        Stream.runForEach((change) => Queue.offer(events, change)),
        Effect.forkScoped,
      )
      const info = yield* hub.resolve({ dir: "app", cwd: disk.root })
      let edits = 0
      const seen = yield* eventually(
        Effect.suspend(() => disk.write("app/TODO.md", md("# App", "", `Edit ${edits++}`))),
        takeWithin(events, "300 millis"),
      )

      expect(seen).toEqual(Option.some({ kind: "changed", project: info.name }))
    }),
    diskWith({ "app/TODO.md": md("# App") }),
  )

  liveTest(
    "a registry edit on disk closes the service of a removed project",
    Effect.gen(function* () {
      const disk = yield* Disk
      const closed = yield* Queue.unbounded<string>()
      const base = memorySource()
      const source: Source<MemoryConfig> = {
        ...base,
        open: (project) =>
          Layer.merge(
            base.open(project),
            Layer.effectDiscard(
              Effect.addFinalizer(() => Effect.asVoid(Queue.offer(closed, project.name))),
            ),
          ),
      }

      const hub = yield* hubOn([source])

      yield* hub.changes.pipe(Stream.runDrain, Effect.forkScoped)
      yield* hub.todo("m")
      const seen = yield* eventually(
        disk.write(".todo-md/projects.yaml", md("projects:", "  other:", "    source: memory")),
        takeWithin(closed, "300 millis"),
      )

      expect(seen).toEqual(Option.some("m"))
    }),
    diskWith({ ".todo-md/projects.yaml": md("projects:", "  m:", "    source: memory") }),
  )
})
