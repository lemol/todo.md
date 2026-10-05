import { describe, expect, test } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { type Duration, Effect, Exit, Option, Queue, Stream } from "effect"
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

  liveTest(
    "emits once per burst of writes and ignores the lock and temporary files",
    Effect.gen(function* () {
      const disk = yield* Disk
      const events = yield* Queue.unbounded<void>()
      yield* changesOf(disk.root).pipe(
        Stream.runForEach(() => Queue.offer(events, undefined)),
        Effect.provide(BunServices.layer),
        Effect.forkScoped,
      )
      const fired = (within: Duration.Input) =>
        Effect.map(takeWithin(events, within), Option.isSome)

      // Arm: touch a probe file until the watch reports it, then let it settle.
      let probes = 0
      const armed = yield* eventually(
        Effect.suspend(() => disk.write("probe.md", String(probes++))),
        takeWithin(events, "200 millis"),
      )

      expect(Option.isSome(armed)).toBe(true)
      let settling = true

      while (settling) settling = yield* fired("300 millis")

      yield* disk.write("tasks/01-one.md", "one")
      yield* disk.write("tasks/01-one.md", "two")
      expect(yield* fired("5 seconds")).toBe(true)
      expect(yield* fired("500 millis")).toBe(false)

      yield* disk.write(".todo.lock", "lock")
      yield* disk.write("ignored.tmp", "temp")
      expect(yield* fired("500 millis")).toBe(false)
    }),
    diskWith({ "TODO.md": md("# App") }),
  )

  liveTest(
    "skips what a caller's ignore rejects, such as git's own directory",
    Effect.gen(function* () {
      const disk = yield* Disk
      const events = yield* Queue.unbounded<void>()
      yield* watchList(disk.root, { ignore: (path) => path.split(/[\\/]/).includes(".git") }).pipe(
        Stream.runForEach(() => Queue.offer(events, undefined)),
        Effect.provide(BunServices.layer),
        Effect.forkScoped,
      )
      const fired = (within: Duration.Input) =>
        Effect.map(takeWithin(events, within), Option.isSome)

      let probes = 0
      const armed = yield* eventually(
        Effect.suspend(() => disk.write("probe.md", String(probes++))),
        takeWithin(events, "200 millis"),
      )

      expect(Option.isSome(armed)).toBe(true)
      let settling = true

      while (settling) settling = yield* fired("300 millis")

      yield* disk.write(".git/refs/heads/main", "abc")
      expect(yield* fired("500 millis")).toBe(false)

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
