import { describe, expect, test } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { type LockOptions, makeLock } from "../../src/fs/lock.ts"
import { Disk, diskWith, filesOnDisk } from "./helpers.ts"

// These run on the real clock: the lock waits and ages in real time.
const run = <A, E>(effect: Effect.Effect<A, E, Disk>) =>
  Effect.runPromise(Effect.provide(effect, diskWith({ "counter.txt": "0" })))

const lockFor = (options?: Partial<LockOptions>) =>
  Effect.gen(function* () {
    const { root } = yield* Disk
    return yield* makeLock(root, {
      timeout: "10 seconds",
      staleAfter: "30 seconds",
      retryEvery: "5 millis",
      ...options,
    }).pipe(Effect.provide(BunServices.layer))
  })

describe("the list lock", () => {
  test("runs locked effects one at a time, so read-modify-write loses nothing", () =>
    run(
      Effect.gen(function* () {
        const files = yield* filesOnDisk
        const lock = yield* lockFor()
        const increment = Effect.gen(function* () {
          const value = Number(yield* files.read("counter.txt"))
          yield* Effect.sleep("2 millis")
          yield* files.write("counter.txt", String(value + 1))
        })
        yield* Effect.all(
          Array.from({ length: 10 }, () => lock(increment)),
          { concurrency: "unbounded" },
        )
        expect(yield* files.read("counter.txt")).toBe("10")
      }),
    ))

  test("fails after the timeout while another process holds the lock", () =>
    run(
      Effect.gen(function* () {
        yield* (yield* Disk).write(".todo.lock", "")
        const lock = yield* lockFor({ timeout: "100 millis" })
        const error = yield* Effect.flip(lock(Effect.void))
        expect(error._tag).toBe("StoreError")
        expect(error.message).toContain("locked by another process")
      }),
    ))

  test("takes over a lock left by a crashed process", () =>
    run(
      Effect.gen(function* () {
        const disk = yield* Disk
        yield* disk.write(".todo.lock", "")
        yield* disk.setModified(".todo.lock", new Date(0))
        const lock = yield* lockFor({ timeout: "100 millis" })
        expect(yield* lock(Effect.succeed("ran"))).toBe("ran")
        expect(yield* disk.exists(".todo.lock")).toBe(false)
      }),
    ))

  test("releases the lock however the effect ends", () =>
    run(
      Effect.gen(function* () {
        const disk = yield* Disk
        const lock = yield* lockFor()
        expect(yield* Effect.flip(lock(Effect.fail("boom")))).toBe("boom")
        expect(yield* disk.exists(".todo.lock")).toBe(false)
        yield* Effect.exit(lock(Effect.die("defect")))
        expect(yield* disk.exists(".todo.lock")).toBe(false)
      }),
    ))

  test("writes a unique ownership token into the lock file", () =>
    run(
      Effect.gen(function* () {
        const disk = yield* Disk
        const lock = yield* lockFor()
        let token = ""
        yield* lock(
          Effect.gen(function* () {
            token = yield* disk.read(".todo.lock")
          }),
        )
        expect(token.length).toBeGreaterThan(0)
        expect(yield* disk.exists(".todo.lock")).toBe(false)
      }),
    ))

  test("does not remove the lock on release if another process took it over", () =>
    run(
      Effect.gen(function* () {
        const disk = yield* Disk
        const lock = yield* lockFor()
        yield* lock(
          Effect.gen(function* () {
            yield* disk.write(".todo.lock", "other-token")
          }),
        )
        expect(yield* disk.exists(".todo.lock")).toBe(true)
        expect(yield* disk.read(".todo.lock")).toBe("other-token")
      }),
    ))

  test("handles lock file already removed when releasing", () =>
    run(
      Effect.gen(function* () {
        const disk = yield* Disk
        const files = yield* filesOnDisk
        const lock = yield* lockFor()
        yield* lock(files.remove(".todo.lock"))
        expect(yield* disk.exists(".todo.lock")).toBe(false)
      }),
    ))

  test("allows calling makeLock with no options and defaults them internally", () =>
    run(
      Effect.gen(function* () {
        const { root } = yield* Disk
        const lock = yield* makeLock(root).pipe(Effect.provide(BunServices.layer))
        expect(yield* lock(Effect.succeed("ok"))).toBe("ok")
      }),
    ))
})
