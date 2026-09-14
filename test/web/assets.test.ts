import { expect, test } from "bun:test"
import { serveRootFor } from "../../src/web/app/assets.ts"

test("mounts the bun store root when remix is hoisted into it", () => {
  expect(serveRootFor("/ws/node_modules/.bun/remix@3.0.0-rc.2/node_modules")).toBe(
    "/ws/node_modules/.bun",
  )
})

test("mounts the neighbouring tree when remix is installed locally", () => {
  expect(serveRootFor("/repo/node_modules")).toBe("/repo/node_modules")
})
