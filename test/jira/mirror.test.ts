import { describe, expect } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { DateTime, Effect, Layer, Option } from "effect"
import { TestClock } from "effect/testing"
import { mirrorFile, patchMirror, readMirror, writeMirror } from "../../src/jira/mirror.ts"
import type { Task } from "../../src/spec/index.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, diskWith } from "../fs/helpers.ts"

/** A temporary directory, plus the platform services the mirror needs. */
const onDisk = Layer.provideMerge(diskWith({}), BunServices.layer)

const at = (iso: string) => Option.getOrThrow(DateTime.make(iso))

const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id,
  title: id,
  description: "",
  status: "open",
  tags: [],
  dependsOn: [],
  comments: [],
  extra: {},
  ...overrides,
})

describe("the Jira mirror", () => {
  effectTest(
    "reads back everything it wrote",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const written = {
        version: 1 as const,
        syncedAt: at("2026-09-19T10:00:00.000Z"),
        open: [
          task("PROJ-1", {
            description: "Details.",
            tags: ["backend"],
            assignee: "ana-silva",
            dependsOn: ["PROJ-9"],
            comments: [{ author: "bo-chen", at: at("2026-09-18T08:00:00.000Z"), body: "Looked." }],
            extra: { url: "https://acme.atlassian.net/browse/PROJ-1", status: "To Do" },
          }),
        ],
        done: [task("PROJ-2", { status: "done", completedAt: at("2026-09-17T12:00:00.000Z") })],
      }

      yield* writeMirror(root, written)
      const read = yield* readMirror(root)

      expect(Option.isSome(read)).toBe(true)
      expect(Option.getOrThrow(read)).toEqual(written)
    }),
    onDisk,
  )

  effectTest(
    "reads a directory without a mirror as none",
    Effect.gen(function* () {
      const { root } = yield* Disk

      expect(Option.isNone(yield* readMirror(root))).toBe(true)
    }),
    onDisk,
  )

  effectTest(
    "fails with the file's name when the mirror is corrupt",
    Effect.gen(function* () {
      const { root, write } = yield* Disk

      yield* write(mirrorFile, "{ not json")
      const error = yield* Effect.flip(readMirror(root))

      expect(error._tag).toBe("StoreError")
      expect(error.message).toContain(mirrorFile)
    }),
    onDisk,
  )

  effectTest(
    "leaves no temporary file behind",
    Effect.gen(function* () {
      const { root, tree } = yield* Disk

      yield* writeMirror(root, {
        version: 1,
        syncedAt: at("2026-09-19T10:00:00.000Z"),
        open: [],
        done: [],
      })
      expect(yield* tree()).toEqual([mirrorFile])
    }),
    onDisk,
  )
})

describe("the Jira mirror: patches", () => {
  const base = {
    version: 1 as const,
    syncedAt: at("2026-09-19T10:00:00.000Z"),
    open: [task("PROJ-1"), task("PROJ-2"), task("PROJ-3")],
    done: [
      task("PROJ-8", { status: "done", completedAt: at("2026-09-18T12:00:00.000Z") }),
      task("PROJ-9", { status: "done", completedAt: at("2026-09-16T12:00:00.000Z") }),
    ],
  }

  const ids = (tasks: ReadonlyArray<Task>) => tasks.map((one) => one.id)
  const current = (root: string) => Effect.map(readMirror(root), Option.getOrThrow)

  effectTest(
    "keeps an open task in place, and files a done one by completion time",
    Effect.gen(function* () {
      const { root } = yield* Disk

      yield* writeMirror(root, base)
      yield* patchMirror(root, task("PROJ-2", { title: "Renamed" }))
      const done = task("PROJ-1", { status: "done", completedAt: at("2026-09-17T12:00:00.000Z") })

      yield* patchMirror(root, done)
      const mirror = yield* current(root)

      expect(ids(mirror.open)).toEqual(["PROJ-2", "PROJ-3"])
      expect(mirror.open[0]?.title).toBe("Renamed")
      expect(ids(mirror.done)).toEqual(["PROJ-8", "PROJ-1", "PROJ-9"])
      // Reopened, it goes to the end of the open tasks.
      yield* patchMirror(root, task("PROJ-9"))
      expect(ids((yield* current(root)).open)).toEqual(["PROJ-2", "PROJ-3", "PROJ-9"])
    }),
    onDisk,
  )

  effectTest(
    "does nothing to a project that was never synced",
    Effect.gen(function* () {
      const { root } = yield* Disk

      yield* patchMirror(root, task("PROJ-1"))
      expect(Option.isNone(yield* readMirror(root))).toBe(true)
    }),
    onDisk,
  )

  effectTest(
    "survives a sync that fetched the issue before the patch, and not one after",
    Effect.gen(function* () {
      const { root } = yield* Disk

      yield* TestClock.setTime(Date.parse("2026-09-19T10:00:00.000Z"))
      yield* writeMirror(root, base)
      const syncStarted = yield* DateTime.now

      yield* TestClock.adjust("1 second")
      yield* patchMirror(root, task("PROJ-1", { status: "done", completedAt: yield* DateTime.now }))
      yield* TestClock.adjust("1 second")

      // The sync fetched PROJ-1 while it was still open.
      const stale = { ...base, syncedAt: yield* DateTime.now }

      yield* writeMirror(root, stale, syncStarted)
      let mirror = yield* current(root)
      expect(ids(mirror.open)).toEqual(["PROJ-2", "PROJ-3"])
      expect(ids(mirror.done)).toEqual(["PROJ-1", "PROJ-8", "PROJ-9"])

      // A sync that started after the patch saw it, and wins.
      const fresh = { ...base, syncedAt: yield* DateTime.now }

      yield* writeMirror(root, fresh, yield* DateTime.now)
      mirror = yield* current(root)
      expect(ids(mirror.open)).toEqual(["PROJ-1", "PROJ-2", "PROJ-3"])
      expect(mirror.patched).toBeUndefined()
    }),
    onDisk,
  )
})
