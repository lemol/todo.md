import { describe, expect, test } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { type Duration, Effect, Exit, FileSystem, Layer, Option, Queue, Stream } from "effect"
import { fsSource, watchList } from "../../src/hub/index.ts"
import { listRootOf } from "../../src/hub/sources/fs.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, diskWith, eventually, liveTest, md, takeWithin } from "./helpers.ts"

const inBun = <A, E>(effect: Effect.Effect<A, E, BunServices.BunServices>) =>
  Effect.provide(effect, BunServices.layer)

describe("fsSource", () => {
  test("names a project after its directory, skipping a trailing todo/", () => {
    expect(fsSource.defaultName?.({ path: "/code/My App" })).toBe("my-app")
    expect(fsSource.defaultName?.({ path: "/code/app/todo" })).toBe("app")
    expect(fsSource.defaultName?.({ path: "/code/app/" })).toBe("app")
    expect(fsSource.defaultName?.({ path: "/" })).toBeUndefined()
    expect(fsSource.location({ path: "/code/app" })).toBe("/code/app")
  })

  effectTest(
    "finds the list at path/todo first, then at path, without walking up",
    Effect.gen(function* () {
      const { root } = yield* Disk

      expect(yield* inBun(listRootOf(`${root}/both`))).toEqual(Option.some(`${root}/both/todo`))
      expect(yield* inBun(listRootOf(`${root}/flat`))).toEqual(Option.some(`${root}/flat`))
      expect(yield* inBun(listRootOf(`${root}/flat/src`))).toEqual(Option.none())
    }),
    diskWith({
      "both/TODO.md": md("# Outer"),
      "both/todo/TODO.md": md("# Inner"),
      "flat/TODO.md": md("# Flat"),
      "flat/src/index.ts": "",
    }),
  )

  effectTest(
    "owns the list root it opens",
    Effect.gen(function* () {
      const { root } = yield* Disk

      const owns = (path: string, listRoot: string) =>
        inBun(fsSource.owns?.({ path }, listRoot) ?? Effect.succeed(false))

      expect(yield* owns(`${root}/both`, `${root}/both/todo`)).toBe(true)
      expect(yield* owns(`${root}/both/todo`, `${root}/both/todo`)).toBe(true)
      expect(yield* owns(`${root}/both`, `${root}/both`)).toBe(false)
      expect(yield* owns(`${root}/missing`, `${root}/missing`)).toBe(false)
    }),
    diskWith({ "both/TODO.md": md("# Outer"), "both/todo/TODO.md": md("# Inner") }),
  )
})

describe("fsSource.changes", () => {
  const changesOf = (path: string) =>
    fsSource.changes?.({ name: "app", config: { path }, dir: undefined }) ?? Stream.empty

  /**
   * Runs `changes` under a `FileSystem` whose watches also record each raw
   * event, before any filter, so a quiet window can tell its own write firing
   * from a late event of an earlier write.
   */
  const watching = <E>(changes: Stream.Stream<void, E, BunServices.BunServices>) =>
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<void>()
      const raw: Array<{ readonly path: string; readonly at: number }> = []
      let emittedAt = 0

      const tap = Layer.effect(
        FileSystem.FileSystem,
        Effect.map(FileSystem.FileSystem, (fs) => ({
          ...fs,
          watch: (path: string, options?: FileSystem.WatchOptions) =>
            fs
              .watch(path, options)
              .pipe(
                Stream.tap((event) =>
                  Effect.sync(() => raw.push({ path: event.path, at: performance.now() })),
                ),
              ),
        })),
      )

      yield* changes.pipe(
        Stream.runForEach(() =>
          Effect.andThen(
            Effect.sync(() => (emittedAt = performance.now())),
            Queue.offer(events, undefined),
          ),
        ),
        Effect.provide(tap),
        Effect.provide(BunServices.layer),
        Effect.forkScoped,
      )
      const fired = (within: Duration.Input) =>
        Effect.map(takeWithin(events, within), Option.isSome)

      /**
       * Runs `write` and waits `within` for an emission. `late` holds the raw
       * paths since the last emission that `own` does not claim: only those
       * can make a debounced watch fire again, besides `write` itself. `seen`
       * holds the raw paths since the window opened.
       */
      const quiet = (
        write: Effect.Effect<void>,
        within: Duration.Input,
        own: (path: string) => boolean,
      ) =>
        Effect.gen(function* () {
          const since = emittedAt
          const opened = performance.now()

          yield* write
          const emitted = yield* fired(within)

          return {
            emitted,
            late: raw
              .filter((event) => event.at > since && !own(event.path))
              .map((event) => event.path),
            seen: raw.filter((event) => event.at >= opened).map((event) => event.path),
          }
        })

      return { events, fired, quiet }
    })

  /** Touches a probe file until the watch reports it, then lets it settle. */
  const arm = (
    disk: Disk["Service"],
    fired: (within: Duration.Input) => Effect.Effect<boolean>,
    events: Queue.Queue<void>,
  ) =>
    Effect.gen(function* () {
      let probes = 0
      const armed = yield* eventually(
        Effect.suspend(() => disk.write("probe.md", String(probes++))),
        takeWithin(events, "200 millis"),
      )

      expect(Option.isSome(armed)).toBe(true)
      let settling = true

      while (settling) settling = yield* fired("300 millis")
    })

  liveTest(
    "emits once per burst of writes and ignores the lock and temporary files",
    Effect.gen(function* () {
      const disk = yield* Disk
      const { events, fired, quiet } = yield* watching(changesOf(disk.root))

      yield* arm(disk, fired, events)

      yield* disk.write("tasks/01-one.md", "one")
      yield* disk.write("tasks/01-one.md", "two")
      expect(yield* fired("5 seconds")).toBe(true)

      // A second emission is excused only by a late event: one burst, one emission.
      const after = yield* quiet(Effect.void, "500 millis", () => false)

      expect(after).not.toMatchObject({ emitted: true, late: [] })

      const ignored = yield* quiet(
        Effect.andThen(disk.write(".todo.lock", "lock"), disk.write("ignored.tmp", "temp")),
        "500 millis",
        (path) => path === ".todo.lock" || path === "ignored.tmp",
      )

      expect(ignored.seen).toEqual(expect.arrayContaining([".todo.lock", "ignored.tmp"]))
      expect(ignored).not.toMatchObject({ emitted: true, late: [] })
    }),
    diskWith({ "TODO.md": md("# App") }),
  )

  liveTest(
    "skips what a caller's ignore rejects, such as git's own directory",
    Effect.gen(function* () {
      const disk = yield* Disk

      const isGit = (path: string) => path.split(/[\\/]/).includes(".git")

      const { events, fired, quiet } = yield* watching(watchList(disk.root, { ignore: isGit }))

      yield* arm(disk, fired, events)

      const git = yield* quiet(disk.write(".git/refs/heads/main", "abc"), "500 millis", isGit)

      expect(git.seen).toContain(".git/refs/heads/main")
      expect(git).not.toMatchObject({ emitted: true, late: [] })

      yield* disk.write("TODO.md", md("# App", "", "- [ ] 01 - One"))
      expect(yield* fired("5 seconds")).toBe(true)
    }),
    diskWith({ "TODO.md": md("# App") }),
  )

  effectTest(
    "ends without failing when there is no list",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const exit = yield* Effect.exit(
        changesOf(`${root}/gone`).pipe(Stream.runDrain, Effect.provide(BunServices.layer)),
      )

      expect(Exit.isSuccess(exit)).toBe(true)
    }),
    diskWith({}),
  )
})
