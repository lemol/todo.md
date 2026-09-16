import { describe, expect, test } from "bun:test"
import { DateTime, Effect } from "effect"
import { fsSource, type ProjectStatus, statusText } from "../../src/hub/index.ts"
import { memorySource } from "../../src/hub/testing.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, diskWith, hubOn, md } from "./helpers.ts"

/** `status` with `lastSync` as an ISO string, for comparisons. */
const plain = (status: ProjectStatus) => ({
  ...status,
  lastSync: status.lastSync === undefined ? undefined : DateTime.formatIso(status.lastSync),
})

const registry = { ".todo-md/projects.yaml": md("projects:", "  m:", "    source: memory") }

const stateJson = JSON.stringify({
  version: 1,
  lastSync: "2026-09-13T10:00:00.000Z",
  result: "error",
  error: "rebase conflict",
  diverged: true,
})

describe("status", () => {
  effectTest(
    "is never for a project that has not synced",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource()])
      expect(yield* hub.status("m")).toEqual({ result: "never" })
    }),
    diskWith(registry),
  )

  effectTest(
    "reads the project's state.json",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource()])
      expect(plain(yield* hub.status("m"))).toEqual({
        lastSync: "2026-09-13T10:00:00.000Z",
        result: "error",
        error: "rebase conflict",
        diverged: true,
      })
    }),
    diskWith({ ...registry, ".todo-md/projects/m/state.json": stateJson }),
  )

  effectTest(
    "overlays the source's live fields",
    Effect.gen(function* () {
      const hub = yield* hubOn([
        memorySource({ status: () => Effect.succeed({ ahead: 2, behind: 1 }) }),
      ])
      expect(plain(yield* hub.status("m"))).toEqual({
        lastSync: "2026-09-13T10:00:00.000Z",
        result: "error",
        error: "rebase conflict",
        diverged: true,
        ahead: 2,
        behind: 1,
      })
    }),
    diskWith({ ...registry, ".todo-md/projects/m/state.json": stateJson }),
  )

  effectTest(
    "leaves out a failing source status",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource({ status: () => Effect.die(new Error("no git")) })])
      expect(yield* hub.status("m")).toEqual({ result: "never" })
    }),
    diskWith(registry),
  )

  effectTest(
    "reports an unreadable state.json as an error status",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const hub = yield* hubOn([memorySource()])
      const status = yield* hub.status("m")
      expect(status.result).toBe("error")
      expect(status.error).toContain(`could not read ${root}/.todo-md/projects/m/state.json`)
    }),
    diskWith({ ...registry, ".todo-md/projects/m/state.json": "{" }),
  )

  effectTest(
    "is never for an unregistered project",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const hub = yield* hubOn([fsSource])
      const info = yield* hub.resolve({ dir: "app", cwd: root })
      expect(info.status).toEqual({ result: "never" })
      expect(yield* hub.status(info.name)).toEqual({ result: "never" })
    }),
    diskWith({ "app/TODO.md": md("# App") }),
  )

  effectTest(
    "fails with ProjectNotFound for an unknown name",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource()])
      expect((yield* Effect.flip(hub.status("nope")))._tag).toBe("ProjectNotFound")
    }),
    diskWith(registry),
  )

  effectTest(
    "is part of every project in projects()",
    Effect.gen(function* () {
      const hub = yield* hubOn([memorySource()])
      const [project] = yield* hub.projects()
      expect(project?.status.result).toBe("error")
      expect(project?.status.diverged).toBe(true)
    }),
    diskWith({ ...registry, ".todo-md/projects/m/state.json": stateJson }),
  )

  describe("statusText", () => {
    const now = DateTime.makeUnsafe("2026-09-16T12:00:00.000Z")
    const at = (iso: string) => DateTime.makeUnsafe(iso)

    test("reads a never-synced project", () => {
      expect(statusText({ result: "never" }, now)).toBe("never synced")
      expect(statusText({ result: "ok" }, now)).toBe("never synced")
    })

    test("reads elapsed time in the largest whole unit", () => {
      expect(statusText({ result: "ok", lastSync: at("2026-09-16T11:59:30.000Z") }, now)).toBe(
        "synced just now",
      )
      expect(statusText({ result: "ok", lastSync: at("2026-09-16T11:45:00.000Z") }, now)).toBe(
        "synced 15m ago",
      )
      expect(statusText({ result: "ok", lastSync: at("2026-09-16T09:00:00.000Z") }, now)).toBe(
        "synced 3h ago",
      )
      expect(statusText({ result: "ok", lastSync: at("2026-09-14T12:00:00.000Z") }, now)).toBe(
        "synced 2d ago",
      )
    })

    test("prefers diverged, then ahead, then an error", () => {
      expect(statusText({ result: "ok", diverged: true, ahead: 2 }, now)).toBe("diverged")
      expect(statusText({ result: "error", ahead: 1 }, now)).toBe("ahead 1")
      expect(statusText({ result: "error" }, now)).toBe("error: unknown error")
      expect(statusText({ result: "error", error: "auth failed" }, now)).toBe("error: auth failed")
    })

    test("never reports a negative age", () => {
      expect(statusText({ result: "ok", lastSync: at("2026-09-16T12:30:00.000Z") }, now)).toBe(
        "synced just now",
      )
    })
  })
})
