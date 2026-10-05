import { describe, expect } from "bun:test"
import { DateTime, Effect, Queue } from "effect"
import { TestClock } from "effect/testing"
import { SyncError } from "../../src/hub/index.ts"
import { memorySource } from "../../src/hub/testing.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, diskWith, hubOn, listen, liveTest, makeWatchers, md } from "./helpers.ts"

const epoch = "1970-01-01T00:00:00.000Z"

const failing = (project: string) =>
  new SyncError({ project, reason: "diverged", message: "rebase conflict" })

describe("sync", () => {
  effectTest(
    "a source without sync has nothing to sync and writes nothing",
    Effect.gen(function* () {
      const disk = yield* Disk
      const hub = yield* hubOn([memorySource()])
      yield* hub.add({ name: "m", source: "memory", config: {} })
      const result = yield* hub.sync("m")
      expect(result).toMatchObject({ project: "m", summary: "nothing to sync" })
      expect(yield* disk.exists(".todo-md/projects/m/state.json")).toBe(false)
    }),
    diskWith({}),
  )

  effectTest(
    "a successful sync is returned and recorded",
    Effect.gen(function* () {
      const disk = yield* Disk
      const hub = yield* hubOn([
        memorySource({ sync: () => Effect.succeed({ summary: "pulled 3", ahead: 0, behind: 0 }) }),
      ])

      yield* hub.add({ name: "m", source: "memory", config: {} })
      const result = yield* hub.sync("m")
      expect({ ...result, at: DateTime.formatIso(result.at) }).toEqual({
        project: "m",
        summary: "pulled 3",
        ahead: 0,
        behind: 0,
        at: epoch,
      })
      expect(JSON.parse(yield* disk.read(".todo-md/projects/m/state.json"))).toEqual({
        version: 1,
        lastSync: epoch,
        result: "ok",
        diverged: false,
      })
      const status = yield* hub.status("m")
      expect(status.result).toBe("ok")
      expect(status.lastSync && DateTime.formatIso(status.lastSync)).toBe(epoch)
    }),
    diskWith({}),
  )

  effectTest(
    "a failed sync is recorded, then fails",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource({ sync: (p) => Effect.fail(failing(p.name)) })])
      yield* hub.add({ name: "m", source: "memory", config: {} })
      const error = yield* Effect.flip(hub.sync("m"))
      expect(error).toMatchObject({ _tag: "SyncError", reason: "diverged" })
      expect(yield* hub.status("m")).toMatchObject({
        result: "error",
        error: "rebase conflict",
        diverged: true,
      })
    }),
    diskWith({}),
  )

  effectTest(
    "records the state of a hand-written entry without a data directory",
    Effect.gen(function* () {
      const disk = yield* Disk
      const hub = yield* hubOn([memorySource({ sync: () => Effect.succeed({ summary: "ok" }) })])
      yield* hub.sync("m")
      expect(yield* disk.exists(".todo-md/projects/m/state.json")).toBe(true)
    }),
    diskWith({ ".todo-md/projects.yaml": md("projects:", "  m:", "    source: memory") }),
  )

  effectTest(
    "publishes synced after a success and after a failure",
    Effect.gen(function* () {
      const watchers = yield* makeWatchers
      const hub = yield* hubOn([
        memorySource({
          changes: watchers.changes,
          sync: (p) =>
            p.name === "bad" ? Effect.fail(failing(p.name)) : Effect.succeed({ summary: "ok" }),
        }),
      ])

      const { events } = yield* listen(hub, watchers.started)
      yield* hub.sync("good")
      expect(yield* Queue.take(events)).toEqual({ kind: "synced", project: "good" })
      yield* Effect.flip(hub.sync("bad"))
      expect(yield* Queue.take(events)).toEqual({ kind: "synced", project: "bad" })
    }),
    diskWith({
      ".todo-md/projects.yaml": md(
        "projects:",
        "  good:",
        "    source: memory",
        "  bad:",
        "    source: memory",
      ),
    }),
  )

  effectTest(
    "fails with ProjectNotFound for an unknown name",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource()])
      expect((yield* Effect.flip(hub.sync("nope")))._tag).toBe("ProjectNotFound")
    }),
    diskWith({}),
  )

  liveTest(
    "syncs of one project run one after the other",
    Effect.gen(function* () {
      let running = 0
      let most = 0
      const hub = yield* hubOn([
        memorySource({
          sync: () =>
            Effect.gen(function* () {
              running += 1
              most = Math.max(most, running)
              yield* Effect.sleep("50 millis")
              running -= 1

              return { summary: "ok" }
            }),
        }),
      ])

      yield* hub.add({ name: "m", source: "memory", config: {} })
      yield* Effect.all([hub.sync("m"), hub.sync("m"), hub.sync("m")], {
        concurrency: "unbounded",
      })
      expect(most).toBe(1)
    }),
    diskWith({}),
  )
})

describe("syncAll", () => {
  effectTest(
    "returns each syncable project's result or failure, in registry order",
    Effect.gen(function* () {
      const hub = yield* hubOn([
        memorySource({
          sync: (p) =>
            p.name === "b"
              ? Effect.fail(failing(p.name))
              : Effect.succeed({ summary: `synced ${p.name}` }),
        }),
        memorySource({ kind: "plain" }),
      ])

      const outcomes = yield* hub.syncAll()
      expect(
        outcomes.map((outcome) =>
          "error" in outcome
            ? [outcome.project, outcome.error.reason]
            : [outcome.project, outcome.summary],
        ),
      ).toEqual([
        ["a", "synced a"],
        ["b", "diverged"],
        ["c", "synced c"],
      ])
    }),
    diskWith({
      ".todo-md/projects.yaml": md(
        "projects:",
        "  a:",
        "    source: memory",
        "  plain:",
        "    source: plain",
        "  b:",
        "    source: memory",
        "  c:",
        "    source: memory",
      ),
    }),
  )
})

describe("autoSync", () => {
  effectTest(
    "syncs every syncable project one interval after startup",
    Effect.gen(function* () {
      const synced = yield* Queue.unbounded<string>()
      yield* hubOn(
        [memorySource({ sync: (p) => Effect.as(Queue.offer(synced, p.name), { summary: "ok" }) })],
        { autoSync: "1 minute" },
      )
      yield* TestClock.adjust("59 seconds")
      expect(yield* Queue.size(synced)).toBe(0)
      yield* TestClock.adjust("1 second")
      expect(yield* Queue.take(synced)).toBe("m")
    }),
    diskWith({ ".todo-md/projects.yaml": md("projects:", "  m:", "    source: memory") }),
  )
})
