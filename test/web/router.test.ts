import { afterEach, expect, test } from "bun:test"
import { makeRouter } from "./harness.ts"

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()))
})

test("allowed GET requests reach the board controller", async () => {
  const { router, project, close } = await makeRouter()
  cleanup.push(close)
  const response = await router.fetch(
    new Request(`http://localhost/p/${project}`, { headers: { Host: "localhost" } }),
  )
  expect(response.status).toBe(200)
  expect(await response.text()).toContain("Acme")
})

test("GET / renders the dashboard", async () => {
  const { router, close } = await makeRouter()
  cleanup.push(close)
  const response = await router.fetch(
    new Request("http://localhost/", { headers: { Host: "localhost" } }),
  )
  expect(response.status).toBe(200)
  expect(await response.text()).toContain("Projects")
})

test("an unknown project renders 404", async () => {
  const { router, close } = await makeRouter()
  cleanup.push(close)
  const response = await router.fetch(
    new Request("http://localhost/p/ghost", { headers: { Host: "localhost" } }),
  )
  expect(response.status).toBe(404)
})
