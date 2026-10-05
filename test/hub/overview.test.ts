import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { memorySource } from "../../src/hub/testing.ts"
import { effectTest } from "../../src/spec/testing.ts"
import { diskWith, hubOn, md } from "./helpers.ts"

const registry = diskWith({
  ".todo-md/projects.yaml": md(
    "projects:",
    "  a:",
    "    source: memory",
    "    title: A",
    "    tasks:",
    "      - title: A one",
    "        tags: [x]",
    "      - title: A two",
    "  work:",
    "    source: jira",
    "  b:",
    "    source: other",
    "    tasks:",
    "      - title: B one",
    "        tags: [x]",
  ),
})

// Fresh per test: a memory source keeps its stores for as long as it lives.
const sources = () => [memorySource(), memorySource({ kind: "other" })]

describe("overview", () => {
  effectTest(
    "lists every registered project in registry order, isolating failures",
    Effect.gen(function* () {
      const hub = yield* hubOn(sources())
      const overview = yield* hub.overview()

      expect(
        overview.projects.map((entry) =>
          "listing" in entry
            ? [entry.project.name, entry.listing.title]
            : [entry.project.name, entry.error._tag],
        ),
      ).toEqual([
        ["a", "A"],
        ["work", "SourceUnavailable"],
        ["b", ""],
      ])
      expect(
        overview.tasks.map(({ project, ref, view }) => [project, ref, view.task.title]),
      ).toEqual([
        ["a", "a:1", "A one"],
        ["a", "a:2", "A two"],
        ["b", "b:1", "B one"],
      ])
    }),
    registry,
  )

  effectTest(
    "applies the filter to each project",
    Effect.gen(function* () {
      const hub = yield* hubOn(sources())
      const overview = yield* hub.overview({ filter: { tags: ["x"] } })

      expect(overview.tasks.map(({ ref }) => ref)).toEqual(["a:1", "b:1"])
    }),
    registry,
  )

  effectTest(
    "keeps the given names in order and reports unknown ones",
    Effect.gen(function* () {
      const hub = yield* hubOn(sources())
      const overview = yield* hub.overview({ projects: ["b", "nope", "a"] })

      expect(overview.projects.map((entry) => entry.project.name)).toEqual(["b", "nope", "a"])
      const missing = overview.projects[1]

      expect(missing && "error" in missing ? missing.error._tag : undefined).toBe("ProjectNotFound")
      expect(missing?.project).toMatchObject({ registered: false, status: { result: "error" } })
      expect(overview.tasks.map(({ ref }) => ref)).toEqual(["b:1", "a:1", "a:2"])
    }),
    registry,
  )

  effectTest(
    "keeps only the given sources",
    Effect.gen(function* () {
      const hub = yield* hubOn(sources())
      const overview = yield* hub.overview({ sources: ["other"] })

      expect(overview.projects.map((entry) => entry.project.name)).toEqual(["b"])
    }),
    registry,
  )

  effectTest(
    "includes done tasks after open ones when the filter asks for them",
    Effect.gen(function* () {
      const hub = yield* hubOn(sources())

      yield* (yield* hub.todo("a")).complete("1")
      const overview = yield* hub.overview({ projects: ["a"], filter: { status: "all" } })

      expect(overview.tasks.map(({ ref, view }) => [ref, view.state])).toEqual([
        ["a:2", "ready"],
        ["a:1", "done"],
      ])
    }),
    registry,
  )
})
