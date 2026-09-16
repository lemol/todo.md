import { expect, test } from "bun:test"
import { markDirtyOnInput, refreshDecision, shouldRefresh } from "./refresh.ts"

test("chooses reload for clean pages and notice for dirty pages", () => {
  expect(refreshDecision(false)).toBe("reload")
  expect(refreshDecision(true)).toBe("notice")
  expect(markDirtyOnInput(new Event("input"))).toBe(true)
  expect(markDirtyOnInput(new Event("change"))).toBe(true)
  expect(markDirtyOnInput(new Event("click"))).toBe(false)
})

test("a project page refreshes only on its own project's events", () => {
  const region = { project: "acme", events: [] as ReadonlyArray<string> }
  expect(shouldRefresh(region, { kind: "changed", project: "acme" })).toBe(true)
  expect(shouldRefresh(region, { kind: "synced", project: "acme" })).toBe(true)
  expect(shouldRefresh(region, { kind: "changed", project: "work" })).toBe(false)
  expect(shouldRefresh(region, { kind: "registry" })).toBe(false)
})

test("a hub page refreshes on the event kinds it declares, from any project", () => {
  const dashboard = { project: null, events: ["changed", "synced", "registry"] }
  expect(shouldRefresh(dashboard, { kind: "changed", project: "work" })).toBe(true)
  expect(shouldRefresh(dashboard, { kind: "registry" })).toBe(true)

  const projects = { project: null, events: ["registry", "synced"] }
  expect(shouldRefresh(projects, { kind: "registry" })).toBe(true)
  expect(shouldRefresh(projects, { kind: "synced", project: "work" })).toBe(true)
  expect(shouldRefresh(projects, { kind: "changed", project: "work" })).toBe(false)
})

test("a page with neither a project nor an event list never refreshes", () => {
  expect(shouldRefresh({ project: null, events: [] }, { kind: "changed", project: "x" })).toBe(
    false,
  )
})
