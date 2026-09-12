import { describe, expect, test } from "bun:test"
import { findCycle } from "../../src/spec/graph.ts"

const graph = (edges: Record<string, string[]>) => new Map(Object.entries(edges))

describe("findCycle", () => {
  test("returns undefined for an acyclic graph", () => {
    expect(findCycle(graph({ "1": [], "2": ["1"], "3": ["1", "2"] }))).toBeUndefined()
  })

  test("reports a self-dependency", () => {
    expect(findCycle(graph({ "3": ["3"] }))).toEqual(["3", "3"])
  })

  test("reports the IDs along a cycle", () => {
    expect(findCycle(graph({ "1": ["2"], "2": ["3"], "3": ["1"] }))).toEqual(["1", "2", "3", "1"])
  })

  test("ignores dependencies on unknown IDs", () => {
    expect(findCycle(graph({ "1": ["9"] }))).toBeUndefined()
  })
})
