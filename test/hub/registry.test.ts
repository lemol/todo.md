import { describe, expect, test } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { RegistryError } from "../../src/hub/errors.ts"
import { makeRegistry } from "../../src/hub/registry.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { Disk, diskWith, md } from "./helpers.ts"

const registryOnDisk = Effect.gen(function* () {
  const { root } = yield* Disk

  return yield* makeRegistry(`${root}/.todo-md`).pipe(Effect.provide(BunServices.layer))
})

const commented = md(
  "# My projects",
  "projects:",
  "  # The main one",
  "  a:",
  "    source: fs # local",
  "    path: /code/a",
  "  b:",
  "    source: memory",
)

describe("the registry file", () => {
  effectTest(
    "a missing file is an empty registry, and reading creates nothing",
    Effect.gen(function* () {
      const registry = yield* registryOnDisk

      expect(yield* registry.entries).toEqual([])
      expect(yield* (yield* Disk).tree()).toEqual([])
    }),
    diskWith({}),
  )

  effectTest(
    "entries come back in file order with their fields",
    Effect.gen(function* () {
      const registry = yield* registryOnDisk

      expect(yield* registry.entries).toEqual([
        { name: "a", value: { source: "fs", path: "/code/a" } },
        { name: "b", value: { source: "memory" } },
      ])
    }),
    diskWith({ ".todo-md/projects.yaml": commented }),
  )

  effectTest(
    "the first write creates the home and the file",
    Effect.gen(function* () {
      const registry = yield* registryOnDisk

      yield* registry.update((edit) => Effect.sync(() => edit.add("app", { source: "memory" })))
      expect(yield* (yield* Disk).read(".todo-md/projects.yaml")).toBe(
        md("projects:", "  app:", "    source: memory"),
      )
    }),
    diskWith({}),
  )

  effectTest(
    "add, rename and delete keep comments and order",
    Effect.gen(function* () {
      const registry = yield* registryOnDisk

      yield* registry.update((edit) =>
        Effect.sync(() => {
          edit.add("c", { source: "memory", title: "C" })
          edit.rename("a", "renamed")
          edit.delete("b")
        }),
      )
      expect(yield* (yield* Disk).read(".todo-md/projects.yaml")).toBe(
        md(
          "# My projects",
          "projects:",
          "  # The main one",
          "  renamed:",
          "    source: fs # local",
          "    path: /code/a",
          "  c:",
          "    source: memory",
          "    title: C",
        ),
      )
    }),
    diskWith({ ".todo-md/projects.yaml": commented }),
  )

  effectTest(
    "delete finds a key that is not a string, like has does",
    Effect.gen(function* () {
      const registry = yield* registryOnDisk

      yield* registry.update((edit) =>
        Effect.sync(() => {
          expect(edit.has("2024")).toBe(true)
          edit.delete("2024")
          expect(edit.has("2024")).toBe(false)
        }),
      )
      expect((yield* registry.entries).map((entry) => entry.name)).toEqual(["a", "b"])
      expect(yield* (yield* Disk).read(".todo-md/projects.yaml")).toBe(commented)
    }),
    diskWith({
      ".todo-md/projects.yaml": md(
        "# My projects",
        "projects:",
        "  # The main one",
        "  a:",
        "    source: fs # local",
        "    path: /code/a",
        "  2024:",
        "    source: memory",
        "  b:",
        "    source: memory",
      ),
    }),
  )

  effectTest(
    "adding to an emptied registry writes a block map",
    Effect.gen(function* () {
      const registry = yield* registryOnDisk

      yield* registry.update((edit) => Effect.sync(() => edit.add("a", { source: "memory" })))
      expect(yield* (yield* Disk).read(".todo-md/projects.yaml")).toBe(
        md("projects:", "  a:", "    source: memory"),
      )
    }),
    diskWith({ ".todo-md/projects.yaml": md("projects: {}") }),
  )

  effectTest(
    "a failing edit writes nothing",
    Effect.gen(function* () {
      const registry = yield* registryOnDisk
      const error = yield* Effect.flip(
        registry.update((edit) =>
          Effect.gen(function* () {
            edit.delete("a")

            return yield* new RegistryError({ message: "no" })
          }),
        ),
      )

      expect(error.message).toBe("no")
      expect(yield* (yield* Disk).read(".todo-md/projects.yaml")).toBe(commented)
      expect(yield* (yield* Disk).exists(".todo-md/.todo.lock")).toBe(false)
    }),
    diskWith({ ".todo-md/projects.yaml": commented }),
  )

  for (const [text, reason] of [
    ["projects: [\n", "unparsable YAML"],
    ["- a\n", "a top level that is not a map"],
    ["projects: [a, b]\n", "projects that is not a map"],
  ] as const) {
    effectTest(
      `fails to read ${reason}`,
      Effect.gen(function* () {
        const registry = yield* registryOnDisk
        const error = yield* Effect.flip(registry.entries)

        expect(error._tag).toBe("RegistryError")
        expect(error.message).toContain("projects.yaml")
      }),
      diskWith({ ".todo-md/projects.yaml": text }),
    )
  }
})

// Real clock: the lock retries with sleeps.
test("concurrent updates from two registries over one home all land", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const [one, two] = [yield* registryOnDisk, yield* registryOnDisk]

      yield* Effect.all(
        Array.from({ length: 10 }, (_, i) =>
          (i % 2 === 0 ? one : two).update((edit) =>
            Effect.sync(() => edit.add(`p${i}`, { source: "memory" })),
          ),
        ),
        { concurrency: "unbounded" },
      )
      const names = (yield* one.entries).map((entry) => entry.name).sort()

      expect(names).toEqual(["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"])
    }).pipe(Effect.provide(diskWith({}))),
  ))

const aliasBomb = md(
  "a: &a [x, x, x, x, x, x, x, x, x, x]",
  "b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]",
  "c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]",
  "d: &d [*c, *c, *c, *c, *c, *c, *c, *c, *c, *c]",
  "projects:",
  "  p: [*d, *d, *d, *d, *d, *d, *d, *d, *d, *d]",
)

describe("collection keys", () => {
  effectTest(
    "a registry with a collection key reads without a process warning",
    Effect.gen(function* () {
      const registry = yield* registryOnDisk
      const warnings: unknown[] = []
      const original = process.emitWarning

      process.emitWarning = ((warning: unknown) => {
        warnings.push(warning)
      }) as typeof process.emitWarning

      const entries = yield* registry.entries.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            process.emitWarning = original
          }),
        ),
      )

      expect(entries).toHaveLength(1)
      expect(warnings).toEqual([])
    }),
    diskWith({ ".todo-md/projects.yaml": "projects:\n  ? [a, b]\n  : {source: fs}\n" }),
  )
})

describe("alias failures", () => {
  for (const [text, message] of [
    ["projects:\n  p: *a\n", "Unresolved alias (the anchor must be set before the alias): a"],
    [aliasBomb, "Excessive alias count indicates a resource exhaustion attack"],
    ["unused: *a\nprojects: {}\n", "Unresolved alias (the anchor must be set before the alias): a"],
  ] as const) {
    effectTest(
      `entries fail with a RegistryError: ${text.slice(0, 20)}`,
      Effect.gen(function* () {
        const { root } = yield* Disk
        const registry = yield* registryOnDisk
        const error = yield* Effect.flip(registry.entries)

        expect(error).toBeInstanceOf(RegistryError)
        expect(error.message).toBe(`${root}/.todo-md/projects.yaml: ${message}`)
      }),
      diskWith({ ".todo-md/projects.yaml": text }),
    )

    effectTest(
      `update refuses without calling edit: ${text.slice(0, 20)}`,
      Effect.gen(function* () {
        const { root } = yield* Disk
        const registry = yield* registryOnDisk
        let called = false
        const error = yield* Effect.flip(
          registry.update(() =>
            Effect.sync(() => {
              called = true
            }),
          ),
        )

        expect(error).toBeInstanceOf(RegistryError)
        expect(error.message).toBe(`${root}/.todo-md/projects.yaml: ${message}`)
        expect(called).toBe(false)
        expect(yield* (yield* Disk).read(".todo-md/projects.yaml")).toBe(text)
      }),
      diskWith({ ".todo-md/projects.yaml": text }),
    )
  }

  effectTest(
    "resolving aliases reused by two projects still read",
    Effect.gen(function* () {
      const registry = yield* registryOnDisk

      expect(yield* registry.entries).toEqual([
        { name: "p", value: { source: "fs", path: "/x" } },
        { name: "q", value: { source: "fs", path: "/x" } },
      ])
    }),
    diskWith({
      ".todo-md/projects.yaml": md(
        "base: &b {source: fs, path: /x}",
        "projects:",
        "  p: *b",
        "  q: *b",
      ),
    }),
  )

  effectTest(
    "deleting an anchor still used by another project refuses the write",
    Effect.gen(function* () {
      const { root } = yield* Disk
      const registry = yield* registryOnDisk
      const before = yield* (yield* Disk).read(".todo-md/projects.yaml")
      const error = yield* Effect.flip(
        registry.update((edit) => Effect.sync(() => edit.delete("p"))),
      )

      expect(error).toBeInstanceOf(RegistryError)
      expect(error.message).toBe(
        `${root}/.todo-md/projects.yaml: Unresolved alias (the anchor must be set before the alias): p`,
      )
      expect(yield* (yield* Disk).read(".todo-md/projects.yaml")).toBe(before)
    }),
    diskWith({ ".todo-md/projects.yaml": "projects:\n  p: &p {source: memory}\n  q: *p\n" }),
  )
})
