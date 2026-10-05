import { expect, test } from "bun:test"
import {
  dashboardHref,
  InvalidQuery,
  parseDashboardQuery,
} from "../../../src/web/app/actions/dashboard/query.ts"

const at = (search: string) => new URL(`http://localhost/${search}`)

test("defaults to the projects view with no filters", () => {
  const query = parseDashboardQuery(at(""))

  expect(query.view).toBe("projects")
  expect(query.projects).toEqual([])
  expect(query.sources).toEqual([])
  expect(query.overview).toEqual({})
})

test("maps repeatable project, source and tag parameters", () => {
  const query = parseDashboardQuery(at("?project=acme&project=work&source=fs&tag=docs&tag=web"))

  expect(query.projects).toEqual(["acme", "work"])
  expect(query.sources).toEqual(["fs"])
  expect(query.overview).toEqual({
    projects: ["acme", "work"],
    sources: ["fs"],
    filter: { tags: ["docs", "web"] },
  })
})

test("maps assignee and state into the task filter", () => {
  expect(parseDashboardQuery(at("?assignee=lemol&state=ready")).overview).toEqual({
    filter: { tags: [], assignee: "lemol", state: "ready" },
  })
})

test("drops blank values so an empty filter box is not a filter", () => {
  expect(parseDashboardQuery(at("?assignee=&tag=&project=")).overview).toEqual({})
})

test("accepts the flat view", () => {
  expect(parseDashboardQuery(at("?view=flat")).view).toBe("flat")
})

test("rejects an unknown state or view", () => {
  expect(() => parseDashboardQuery(at("?state=soon"))).toThrow(InvalidQuery)
  expect(() => parseDashboardQuery(at("?view=grid"))).toThrow(InvalidQuery)
})

test("dashboardHref round-trips a query and applies a patch", () => {
  const query = parseDashboardQuery(at("?project=acme&tag=docs&state=ready"))

  expect(dashboardHref(query)).toBe("/?project=acme&tag=docs&state=ready")
  expect(dashboardHref(query, { view: "flat" })).toBe(
    "/?project=acme&tag=docs&state=ready&view=flat",
  )
})
